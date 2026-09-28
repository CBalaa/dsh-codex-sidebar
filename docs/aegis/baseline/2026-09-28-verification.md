# dsh-codex-sidebar — Acceptance Record (A1–A7)

Date: `2026-09-24` (author) … `2026-09-28` (browser round with the user)
Kind: `verification evidence`
Spec under test: `docs/aegis/specs/2026-09-24-codex-sidebar-design.md` §7
Environment: DSH `0.1.5-rc.1`, dsh-better-sidebar `0.19.0`, dsh-bridge `0.1.0-rc.15`,
codex-cli `0.156.1`, node-pty `1.1.0`, node v24.14.0, Linux x64.
Method: plugin hot-installed into `~/.dsh/profiles/web` through the super-injector
(`dev_install_package` / `dev_reload_package`); **the running DSH host was never
restarted** during development.

## Automated evidence

| command | result |
| --- | --- |
| `pnpm run typecheck` | clean (tsc --noEmit) |
| `pnpm test` | **59 passed** in 8 files (fence, argv injection, readiness, delivery, thread id, tools, client bundle, theme) |
| `DSH_CODEX_SMOKE=1 pnpm vitest run tests/pty-smoke.spec.ts tests/bridge-smoke.spec.ts` | **4 passed** — live codex TUI in our pty (banner + composer painted, keystrokes reach it, dispose kills it, paste gated when a modal owns the screen) and the full codex→DSH bridge (built MCP shim as a child process → loopback with token → delivery on the bound session) |
| `pnpm run build` | `lib/index.js` 45.6 kB, `lib/codex-mcp.js` 4.4 kB, `lib/client.js` 412.8 kB |

## A1 — sidebar entry, real codex TUI, interactive

- **User-verified (2026-09-28)**: the `+` menu shows **Codex**; opening it paints the real
  codex TUI in the conversation's working directory, and typing reaches it.
- Headless evidence: `tests/pty-smoke.spec.ts` asserts the transcript contains the
  `>_ OpenAI Codex (v0.156.1)` banner and the `› Ask Codex to do anything` composer,
  and that a keystroke produces output.

## A2 — persistence (refresh / conversation switch / tab close)

- **User-verified**: refresh keeps the same codex (transcript replayed, process alive);
  switching to another conversation and back keeps it; closing and reopening the tab
  reattaches to the same process.
- Design-level evidence: `src/registry.ts` park/grace-close semantics, `src/ws.ts`
  `{park}`/`{close}` handling (close = detach), plus the `terminal-gate` tests.
- **Defect found by this round and fixed**: after a page refresh the panel could mount
  before layout, and a transcript written at the pre-layout geometry (observed 12×3)
  wrapped the TUI frames into unreadable garbage. Fixed by `src/client/terminal-gate.ts`
  (nothing is written, and no geometry is announced, until the terminal is ≥ 30×6) plus a
  `{type:'repaint'}` frame that makes codex redraw at the true size.

## A3 — identity injection and codex → DSH

- **User-verified + observed in this session**: asked in the sidebar, codex answered that it
  is a sidebar-codex and reported its bound DSH session, then called
  `mcp__dsh__send_message`. The message arrived in the bound conversation as a user message
  through `dsh-bridge`:

  ```
  [codex:b8f23f96-fbf7-4c93-b69d-905003309c6c] codex 已上线（实例身份：/root，sidebar-codex；
  绑定 DSH 会话 session-65b85ead-e03a-4bd9-95db-532f1e80132e）
  ```

## A4 — DSH → codex

- **Verified in this session**: the agent called the `codex_send` tool with a Chinese message;
  the tool reported `Delivered to codex via pty.`, codex processed it and replied through the
  MCP tool:

  ```
  [codex:1de997b0-145f-4b23-97da-00b1701592af] 已收到 DSH 反向验证请求，并已通过 mcp__dsh__send_message 回传确认。
  ```

- **Defects found by this round and fixed**:
  1. `codex queue` is the preferred path but needs codex's own thread id, which the TUI
     status line truncates on a narrow sidebar → added rollout-file discovery
     (`src/thread-id.ts`) that parses the `session_meta` line, requires a matching **cwd**,
     a top-level `cli` source, and a unique winner. An ambiguous set refuses to queue
     rather than injecting into somebody else's codex session.
  2. codex echoes CJK one cursor move per wide glyph, so the paste confirmation compared
     `这 是 一 条 …` against a contiguous probe and treated every Chinese message as a
     swallowed paste → the comparison now squeezes whitespace on both sides.
  3. codex paints its composer *before* a late modal (folder trust) clears the screen, and
     the modal is drawn with per-word cursor moves, so `tail.includes('Trust this folder?')`
     never matched → marker checks now run on `plainText()` (escapes → spaces), and Enter is
     sent only after the paste is echoed back.

## A5 — focus wins

- **User-verified**: typing in the codex window goes to codex. No key handler is installed by
  the tab (`src/client/CodexView.tsx`), so xterm's own textarea receives the keystrokes; the
  only pre-xterm interception in the app is better-sidebar's capture-phase IME guard.

## A6 — exit and restart

- **User-verified (corrected report)**: two `Ctrl+C` in the codex window ended the process; the
  terminal showed `[codex exited with code 0]`, the toolbar switched to 已退出 and the 重启
  button started a new codex.

## A7 — cross-site rejection

- Unit-level: `tests/trust-fence.spec.ts` (10 cases) pins the fence — `Sec-Fetch-Site:
  cross-site` rejected, `Origin` must match `Host`, non-trusted foreign Host rejected, LAN
  authority accepted only when DSH trusts it *and* the Origin matches.
- Live probe: the routes are additionally behind `dsh-auth-gate`, so an unauthenticated
  cross-site request is refused before our handler runs:

  ```
  curl -H 'Origin: http://evil.example' … /codex-sidebar/ws?sessionId=probe   → 401
  curl -H 'Sec-Fetch-Site: cross-site'  … /codex-sidebar/api/state            → 401
  ```

  The live probe cannot isolate our fence (the outer gate answers first); the fence's own
  behaviour is the unit-tested surface.

## Defects this acceptance round produced

| # | symptom | root cause | fix |
| --- | --- | --- | --- |
| 1 | unreadable "black window" after refresh | transcript replayed into a pre-layout terminal geometry | `src/client/terminal-gate.ts` + `{type:'repaint'}` |
| 2 | terminal unreadable in DSH (dark-on-dark) | xterm created with bare defaults, no DSH tokens | `src/client/theme.ts` (design tokens + curated ANSI, live re-theme) |
| 3 | `codex_send` never used the clean queue path | thread id truncated in the status line | rollout discovery, cwd-matched and uniqueness-checked |
| 4 | Chinese messages looked like swallowed pastes | wide glyphs echo one cursor move each | whitespace-insensitive paste confirmation |
| 5 | the folder-trust modal was invisible to the gate | codex draws each word with a cursor move | `plainText()` normalisation for marker checks |
| 6 | plugin fiber failed on load | hand-written tool schemas used the spec dialect | real JSON Schema + a test running DSH's own validator |

## Residual / not covered

- `codex queue` end-to-end after a turn is not exercised automatically (it would spend a real
  codex turn); the pty path and the discovery logic are covered, and the queue path was
  demonstrated manually during recon.
- Multi-hour transcript overflow (the 1 MiB ring) is by construction, not tested.
- Windows/macOS are untested (node-pty prebuilds exist there, but the plugin was only run on
  Linux).
