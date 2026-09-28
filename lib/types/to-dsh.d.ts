/**
 * codex → DSH delivery.
 *
 * The canonical owner is dsh-bridge's documented inbound seam
 * (`ctx.dshBridge.deliverExternal`), which wakes idle/running sessions, resumes
 * cold ones and records the delivery. The direct `agent.followup` path is a
 * LOUD degradation for a host without dsh-bridge — not a second messaging owner
 * (spec ADR-1) — and it builds the message structurally so this plugin never
 * imports a second copy of the DSH runtime packages.
 */
import type { CodexInstance } from './registry.ts';
import type { HostAgents, HostBridge, HostLogger } from './host-types.ts';
export interface DeliverToDshDeps {
    bridge?: HostBridge | undefined;
    agents?: HostAgents | undefined;
    log?: HostLogger | undefined;
}
/** Deliver one codex message into the bound DSH session. */
export declare function deliverToDsh(deps: DeliverToDshDeps, instance: CodexInstance, text: string): Promise<void>;
