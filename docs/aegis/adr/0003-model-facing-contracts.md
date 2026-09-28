# ADR-0003 — the injected identity text and the delivery gate are model-facing contracts

Date: 2026-09-28
Status: accepted
Scope: contract

## Context

Three pieces of this plugin are not internal implementation details; changing
them changes behaviour that a human or a model observes:

1. the text injected through `-c developer_instructions` (what codex believes it
   is and which MCP tools it knows about);
2. the readiness gate's marker list and the paste-confirmation rule (whether a
   message is delivered or stays pending);
3. the tool names exposed on both sides (`codex_send` / `codex_read` /
   `codex_status` / `codex_restart`, and `mcp__dsh__send_message` /
   `mcp__dsh__read_messages` / `mcp__dsh__status`).

## Decision

Treat all three as contracts:

- the identity text lives in `src/identity.ts` and its content is asserted by
  `tests/spawn.spec.ts` (it must mention `sidebar-codex` and the MCP tool names);
- the readiness gate and paste confirmation live in `src/readiness.ts` with tests
  for every marker and for the echoed-paste rule; a marker list change is a
  behaviour change, not a tweak;
- tool definitions are validated by DSH's own schema validator in
  `tests/tools.spec.ts`, and the MCP shim's tool list is asserted in the bridge
  smoke test.

The codex build this was verified against (0.156.1) is recorded in the README;
its TUI text is what the markers match.

## Consequences

- A codex upgrade that changes its TUI wording degrades to "message stays
  pending with a reason" rather than typing into the wrong place — the gate is
  allowed to fail closed, and the failure is visible to the model and the user.
- The model-facing names cannot be renamed without updating the tests and the
  docs, which is the point.
