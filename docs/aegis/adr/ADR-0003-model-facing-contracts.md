# ADR-0003 - Injected identity, delivery gate and tool names are model-facing contracts

Status: `recorded-from-spec`
Date: `2026-09-28`

## Source Evidence

- docs/aegis/specs/2026-09-24-codex-sidebar-design.md (ADR-3 signal); tests/spawn.spec.ts, tests/readiness.spec.ts, tests/tools.spec.ts
## Context

Three surfaces change what a human or a model observes: the -c developer_instructions text, the readiness gate's marker list plus the paste-echo rule, and the tool names exposed on both sides.

## Decision

Treat all three as contracts: identity text asserted by tests; readiness markers and the echoed-paste rule covered per marker; tool definitions validated by DSH's own schema validator and the MCP tool list asserted in the bridge smoke test. The verified codex build is recorded in the README.

## Alternatives Considered

- Treat them as ordinary implementation detail (rejected: a silent rename or a marker tweak would change delivery behaviour without any test failing).
## Consequences

- A codex upgrade that changes TUI wording degrades to 'message stays pending with a reason' instead of typing into the wrong place; the gate fails closed and the failure is visible to both the model and the user.
## Compatibility Boundary

The exact tool names (codex_send/codex_read/codex_status/codex_restart, mcp__dsh__send_message/read_messages/status) and the injected identity text are consumed by prompts and docs.

## Retirement Impact

Markers tied to codex 0.156.1 wording must be revisited on every codex upgrade; obsolete markers should be deleted rather than accumulated.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-09-28-verification.md
- Action: update baseline
- Reason: The acceptance record lists the codex build and the defects that the gate and contracts were shaped by.

## Evidence References

- docs/aegis/baseline/2026-09-28-verification.md (A3/A4/A5)
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
