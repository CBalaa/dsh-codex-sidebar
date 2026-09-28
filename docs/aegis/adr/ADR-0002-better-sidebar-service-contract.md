# ADR-0002 - The sidebar tab consumes better-sidebar as a structural service

Status: `recorded-from-spec`
Date: `2026-09-28`

## Source Evidence

- docs/aegis/specs/2026-09-24-codex-sidebar-design.md (ADR-2 signal); dsh-better-sidebar docs/external-plugin-guide.md
## Context

The tab is registered through ctx.betterSidebar.registerTab. Depending on the dsh-better-sidebar package for types would pull its whole dependency tree (mermaid, codemirror, node-pty, ws) into every install and build, and couple our compile to a package we do not control.

## Decision

Use a structural mirror (src/better-sidebar.ts) plus a runtime capability check (supportsTabs) before registering the tab; pin the field semantics in tests that run the built client bundle against a fake service.

## Alternatives Considered

- Type-only dependency on dsh-better-sidebar/client/service (rejected: heavyweight install, compile coupling); declaring the tab in better-sidebar itself (rejected: upstream-sync burden and a second owner for our UI).
## Consequences

- Small install, standalone availability, and a loud single-error degradation if registerTab disappears. The contract is enforced by tests and a runtime probe rather than by the compiler.
## Compatibility Boundary

Depends on the client service publishing registerTab and on the descriptor field names used here (id/title/description/order/single/badge/component).

## Retirement Impact

If better-sidebar publishes a typed consumer package without the heavy tree, or DSH grows a first-class sidebar-tab API, migrate to it and delete the mirror.

## Baseline Sync

- Needed: not-needed
- Target: docs/aegis/baseline/2026-09-24-initial-baseline.md
- Action: cite unchanged
- Reason: The owner table already assigns sidebar registration to better-sidebar; this ADR only records how we consume it.

## Evidence References

- docs/aegis/baseline/2026-09-28-verification.md (A1)
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
