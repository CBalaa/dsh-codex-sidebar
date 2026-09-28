/**
 * dsh-codex-sidebar — client half. Registers the sidebar tab.
 *
 * The service is resolved defensively (`ctx.get`) so a missing or older
 * better-sidebar cannot break the whole client activation. The descriptor is
 * registered inside `ctx.effect` so HMR/disable revokes it (a leftover
 * registration throws "already registered" on the next activation).
 *
 * `badge` runs on every tab-bar render: it reads the module-level state map and
 * never fetches (see ./state.ts for the poll that keeps it fresh).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const inject: string[];
export declare function apply(ctx: Context): void;
