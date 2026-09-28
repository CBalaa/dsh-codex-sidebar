# ADR-0001 - codex -> DSH delivery goes through dsh-bridge

Status: `recorded-from-spec`
Date: `2026-09-28`

## Source Evidence

- docs/aegis/specs/2026-09-24-codex-sidebar-design.md (ADR-1 signal); User decision 2026-09-24
## Context

The sidebar codex must deliver messages into its bound DSH conversation, waking an idle agent. A plugin can call ctx.agents.get(id).followup() directly, which bypasses the session registry's wake/resume path, the archive rule and the delivery audit record.

## Decision

dsh-bridge owns delivery: deliverExternal(from='codex:<instanceId>', to=<bound session>, text, {transport:'codex'}), no plugin-side prefix because dsh-bridge writes the envelope. A direct agent.followup remains only as a loud degradation when dsh-bridge is absent, live sessions only.

## Alternatives Considered

- Direct agent.followup only (rejected: no cold resume, no archive rule, no audit record); an own message bus in this plugin (rejected: duplicates a solved problem and would diverge on wake semantics).
## Consequences

- One delivery owner; wake/resume/archive semantics come for free. The plugin imports no second copy of the DSH runtime packages (the fallback builds the message structurally). Changes to dsh-bridge's seam are a compatibility event for this plugin.
## Compatibility Boundary

Depends on ctx.dshBridge.deliverExternal(from, to, text, {transport}) existing and keeping its wake/resume/archive semantics; the degradation path must stay marked as a degradation.

## Retirement Impact

If DSH ever exposes an equivalent first-class inbound seam for external transports, this plugin should call that instead and drop the fallback.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-09-24-initial-baseline.md
- Action: update baseline
- Reason: Owner table row for DSH delivery is already recorded; the fallback wording needs to stay aligned.

## Evidence References

- docs/aegis/baseline/2026-09-28-verification.md (A3/A4)
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
