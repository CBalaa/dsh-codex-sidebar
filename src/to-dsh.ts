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
import type { CodexInstance } from './registry.ts'
import type { HostAgent, HostAgents, HostBridge, HostLogger } from './host-types.ts'

export interface DeliverToDshDeps {
  bridge?: HostBridge | undefined
  agents?: HostAgents | undefined
  log?: HostLogger | undefined
}

/** Deliver one codex message into the bound DSH session. */
export async function deliverToDsh(
  deps: DeliverToDshDeps,
  instance: CodexInstance,
  text: string,
): Promise<void> {
  const from = `codex:${instance.id}`
  if (deps.bridge !== undefined) {
    await deps.bridge.deliverExternal(from, instance.sessionId, text, { transport: 'codex' })
    return
  }
  const agent: HostAgent | undefined = deps.agents?.get(instance.sessionId)
  if (agent === undefined) {
    throw new Error('dsh-bridge is unavailable and the bound session is not live')
  }
  deps.log?.warn('dsh-bridge unavailable: falling back to a direct agent.followup (no audit record)')
  agent.followup({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `[codex-sidebar ${instance.id}] ${text}` }],
    source: { kind: 'plugin', plugin: 'dsh-codex-sidebar', form: 'codex' },
  })
}
