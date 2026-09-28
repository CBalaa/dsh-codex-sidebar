# ADR-0001 — codex → DSH delivery goes through dsh-bridge

Date: 2026-09-28
Status: accepted
Scope: architecture / owner

## Context

The sidebar codex must be able to send a message into the DSH conversation it is
bound to, waking that agent if it is idle. A plugin can reach an agent directly
(`ctx.agents.get(sessionId).followup(message)`), which is simple but bypasses the
session registry's wake/resume path, the archive rule and the message audit
record.

`dsh-bridge` publishes `ctx.dshBridge.deliverExternal(from, to, text, {transport})`
and documents it as *the* controlled inbound seam for a trusted transport. It
wakes idle sessions, resumes persisted ones through the host agent resolver,
refuses archived targets, and records the delivery.

## Decision

codex → DSH delivery is owned by `dsh-bridge`. This plugin calls
`deliverExternal(from='codex:<instanceId>', to=<bound session>, text, {transport:'codex'})`
and adds no prefix of its own (dsh-bridge writes the envelope, which carries the
sender).

A direct `agent.followup` exists only as a **loud degradation** for a host that
does not have dsh-bridge installed: it logs a warning describing itself as a
degradation without an audit record, and it is used for the live-session case
only.

## Consequences

- One owner for session delivery; wake/resume/archive semantics come for free and
  cannot drift between plugins.
- The plugin does not import a second copy of the DSH runtime packages: the
  fallback builds the user message structurally.
- A future change to dsh-bridge's seam is a compatibility event for this plugin
  (see `docs/aegis/specs/…-design.md` §10 ADR-2).

## Alternatives considered

- **Direct `agent.followup` only** — rejected: no cold-session resume, no archive
  rule, no audit record, and a second delivery owner in the ecosystem.
- **Own message bus in this plugin** — rejected: duplicates a solved problem and
  would diverge on wake semantics.
