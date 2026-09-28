# ADR-0002 — the sidebar tab is consumed as a structural service, not a dependency

Date: 2026-09-28
Status: accepted
Scope: architecture / compatibility

## Context

The tab is registered through `dsh-better-sidebar`'s client service
(`ctx.betterSidebar.registerTab`). Two ways to consume it:

1. depend on the `dsh-better-sidebar` package for its types (`import type {} from
   'dsh-better-sidebar/client/service'`), as its external-plugin guide suggests;
2. declare the service shape ourselves (structural mirror) and check it at
   runtime.

Option 1 pulls that package's dependency tree (mermaid, codemirror, node-pty,
ws…) into every install and build of this plugin, and couples our compile to a
package we do not control. Option 2 loses compile-time checking of the service
shape but keeps the plugin installable on its own.

## Decision

Structural mirror (`src/better-sidebar.ts`) plus a runtime capability check
(`supportsTabs(service)`, which verifies `registerTab` is a function) before
registering. The tab's field semantics are pinned to the documented contract in
the test suite (`tests/client-register.spec.ts` runs the built bundle against a
fake service).

If better-sidebar ever drops `registerTab`, the plugin logs one error and
registers no tab — the host keeps working.

## Consequences

- No heavyweight dependency; `pnpm install` stays small and the plugin can be
  installed from `file:` or npm without better-sidebar's tree.
- The service contract is enforced by tests and by the capability probe, not by
  the compiler; a contract change is caught at the first activation or by the
  test run, not at build time.
- The tab follows better-sidebar automatically into DSH's native right sidebar
  (`registerNativeSurface`), which is what makes the entry appear in the `+` menu.
