# dsh-codex-sidebar

English | 简体中文

> A persistent `codex` CLI session inside the DSH right sidebar, bound 1:1 to a
> conversation, with plugin-mediated messaging between codex and DSH.

Status: **in development** (design approved 2026-09-24; see `docs/aegis/`).

## What it does

- Adds a **Codex** entry to the right sidebar (`dsh-better-sidebar`'s `+` menu).
  Opening it starts a real `codex` TUI (node-pty) in that conversation's working
  directory — behaviourally identical to running `codex` in a terminal, because
  it inherits your `~/.codex/config.toml` untouched.
- The codex process is **persistent**: refreshing the page, switching
  conversations or closing the browser does not kill it. Closing the tab
  detaches (the codex keeps running); an explicit *Stop codex* action ends it.
- codex and the bound DSH conversation can **talk to each other**:
  - codex → DSH through the MCP server `dsh` (`send_message` / `read_messages` /
    `status`), delivered into the conversation by `dsh-bridge`'s inbound seam.
  - DSH → codex through the `codex_send` tool (`codex queue` when the thread is
    known, otherwise a readiness-gated pty injection).
- New codex sessions are **injected with context**: they know they are a
  "sidebar-codex", which DSH session they are bound to, and how to reach it.

## Install (development)

```bash
pnpm install && pnpm run build
dsh plugin --profile web add file:/wafer/chh/gitprojects/dsh-codex-sidebar
```

## Design and plan

- Design spec: `docs/aegis/specs/2026-09-24-codex-sidebar-design.md`
- Implementation plan: `docs/aegis/plans/2026-09-24-codex-sidebar-implementation.md`
- Initial baseline: `docs/aegis/baseline/2026-09-24-initial-baseline.md`

## Verified against

| component | version |
| --- | --- |
| DSH | 0.1.5-rc.1 |
| dsh-better-sidebar | 0.19.0 |
| dsh-bridge | 0.1.0-rc.15 |
| codex-cli | 0.156.1 |
