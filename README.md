# dsh-codex-sidebar

English | [简体中文](README.zh.md)

> A persistent `codex` CLI session inside the DSH right sidebar, bound 1:1 to a
> conversation, with plugin-mediated messaging between codex and DSH.

## What it does

- Adds a **Codex** entry to DSH's native right sidebar (`dsh-better-sidebar`'s
  `+` menu). Opening it starts a real `codex` TUI in that conversation's working
  directory — behaviourally identical to running `codex` in a terminal, because
  it inherits your `~/.codex/config.toml` untouched (approval policy, sandbox
  mode, model, projects, MCP servers, hooks).
- The codex process is **persistent**:

  | event | what happens to codex |
  | --- | --- |
  | page refresh / browser close | keeps running; the tab replays the transcript on reconnect (30s reconnect grace) |
  | switch to another conversation and back | keeps running (parked, no timeout) |
  | close the Codex tab | keeps running (the tab *detaches*); reopening reattaches to the same process |
  | toolbar → *Stop codex* | the process is killed (explicit action) |
  | DSH host restart or plugin reload | the process ends with the host |

- **Focus wins**: the tab installs no key handler, so keystrokes (typing, arrows,
  Ctrl+C, paste) go straight into codex while its terminal has focus.
- **Bidirectional messaging** with the bound conversation:
  - codex → DSH through the MCP server `dsh` (`mcp__dsh__send_message`,
    `mcp__dsh__read_messages`, `mcp__dsh__status`). Messages are delivered into
    the conversation by `dsh-bridge`'s inbound seam, which wakes the DSH agent.
  - DSH → codex through the `codex_send` tool.
- **Injected identity**: every new sidebar codex is told it is a "sidebar-codex",
  which DSH session it is bound to, and how to reach it.

## Tools

| tool | direction | notes |
| --- | --- | --- |
| `codex_send` | DSH → codex | `codex queue` when the thread is known, otherwise a readiness-gated pty paste |
| `codex_read` | DSH ← codex | re-read messages codex sent to this conversation |
| `codex_status` | — | process state, codex thread id, cwd, unread count, terminal tail |
| `codex_restart` | — | respawn an exited codex with the same injection |

## Install

```bash
pnpm install && pnpm run build
dsh plugin --profile web add file:/path/to/dsh-codex-sidebar
```

`node-pty` ships prebuilds for macOS/Windows only, so on Linux its install script
must compile the native module; `pnpm-workspace.yaml` allows that build
(`allowBuilds: node-pty: true`).

## How the two channels work

```
browser ──WS /codex-sidebar/ws──▶ plugin host ──node-pty──▶ codex TUI
   ▲                                   │                      │
   └──── transcript replay / badge ────┘                      │ MCP stdio
                                                             ▼
DSH agent ──codex_send──▶ delivery ──①codex queue / ②pty paste──▶ codex
DSH agent ◀──deliverExternal── plugin loopback ◀── mcp__dsh__send_message ── codex
```

**DSH → codex** (`src/deliver.ts`)
1. `codex queue --thread <id> --message <text>` when codex's own thread id is
   known (discovered from the TUI status line or a rollout file name). This needs
   an existing rollout, so it is unavailable before the first turn.
2. Otherwise a bracketed paste into the pty, but only when the composer is idle
   **and** the paste is echoed back. codex paints its composer *before* a late
   modal (folder trust, approval) clears the screen, and a modal swallows the
   paste — so Enter is only ever sent on an echo. A swallowed paste leaves the
   message pending with a readable reason (`codex is waiting for you (…)`).
3. If neither works the tool fails loudly; nothing is silently dropped.

**codex → DSH** (`src/loopback.ts`, `src/mcp-shim.ts`, `src/to-dsh.ts`)
The MCP shim codex spawns calls the plugin's own loopback server
(`127.0.0.1`, OS-assigned port, per-instance bearer token passed through the
spawn environment) which forwards to `ctx.dshBridge.deliverExternal(...)`. When
dsh-bridge is absent the plugin logs a warning and falls back to a direct
`agent.followup` (no audit record) — a loud degradation, not a second messaging
owner.

## Security

- The `/codex-sidebar/ws` upgrade and the `/codex-sidebar/api/*` routes carry the
  plugin's own fence: `Sec-Fetch-Site: cross-site` is rejected, an `Origin` must
  match `Host`, and the host must be loopback or an authority DSH already trusts.
  `dsh-auth-gate` authenticates but does not defend cross-site WebSocket
  hijacking, so this fence is not optional.
- The loopback bridge binds `127.0.0.1` only and requires a 32-byte per-instance
  token; the token travels through the process environment, never argv or disk.
- The codex process inherits **your** `~/.codex/config.toml`, including any
  `approval_policy` / `sandbox_mode` you set there (this machine currently runs
  `never` + `danger-full-access`, i.e. YOLO). The plugin never overrides them.
- codex's folder-trust prompt is never bypassed: an untrusted directory stays
  untrusted until you answer the prompt in the sidebar.

## Known limits

- Transcript replay is bounded to 1 MiB (same bound as better-sidebar's
  terminal); very long sessions lose the head of their scrollback.
- `codex queue` is undocumented upstream behaviour; if it changes, delivery falls
  back to the pty path.
- The readiness markers are heuristics on codex's TUI text. A failed heuristic
  keeps a message pending — it never types into a modal.
- No tmux persistence: a DSH host restart ends the codex process (by design,
  approved 2026-09-24).

## Verified against

| component | version |
| --- | --- |
| DSH | 0.1.5-rc.1 |
| dsh-better-sidebar | 0.19.0 |
| dsh-bridge | 0.1.0-rc.15 |
| codex-cli | 0.156.1 |
| node-pty | 1.1.0 |

## Development

```bash
pnpm run typecheck     # tsc --noEmit
pnpm test              # 46 unit tests (fence, argv, readiness, delivery, thread id, tools, bundle)
DSH_CODEX_SMOKE=1 pnpm vitest run tests/pty-smoke.spec.ts tests/bridge-smoke.spec.ts
                       # live smoke: real codex TUI in a pty, and shim → loopback → delivery
```

Design and plan live in `docs/aegis/`:

- `specs/2026-09-24-codex-sidebar-design.md` — approved design, contracts, acceptance criteria
- `plans/2026-09-24-codex-sidebar-implementation.md` — task-by-task implementation plan
- `baseline/2026-09-24-initial-baseline.md` — owner / requirement baseline
