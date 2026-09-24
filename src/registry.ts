/**
 * The codex instance registry — the ONLY owner of codex processes in this host.
 *
 * One instance per DSH session (1:1 binding, approved 2026-09-24). The registry
 * owns the pty, the bounded transcript used for reconnect replay, the last-output
 * tail used by the readiness gate, and the two message inboxes.
 *
 * Lifecycle (mirrors better-sidebar's terminal semantics where they apply):
 * - a bare socket drop (page refresh) schedules a close after the grace window;
 *   a reconnect cancels it, so the SAME codex survives a refresh;
 * - `park` (conversation switch) keeps the process alive indefinitely;
 * - `close` (tab closed) is a DETACH: the view goes away, codex keeps running;
 * - explicit `dispose`/`disposeAll` (toolbar "stop", plugin teardown) kills it.
 */
import { randomUUID } from 'node:crypto'
import type { IPty } from 'node-pty'
import { loadNodePty } from './pty-deps.ts'
import { buildSpawnPlan, type SpawnInput, type SpawnPlan } from './spawn.ts'

/** Bytes kept for transcript replay (same bound as better-sidebar's terminal). */
export const TRANSCRIPT_LIMIT = 1 << 20
/** Bytes kept for readiness/marker scanning. */
export const TAIL_LIMIT = 4096
/** Messages kept per inbox. */
export const INBOX_LIMIT = 200

export type CodexState = 'running' | 'exited' | 'error'

export interface CodexMessage {
  id: string
  from: 'dsh' | 'codex'
  text: string
  at: number
}

export interface CodexInstance {
  id: string
  sessionId: string
  cwd: string
  spawn: SpawnInput
  pty: IPty
  transcript: string
  tail: string
  state: CodexState
  exitCode?: number
  error?: string
  /** codex's own session UUID, once discovered from the TUI output. */
  threadId?: string
  /** codex → DSH messages delivered since the user last looked at the tab. */
  unread: number
  /** DSH → codex messages (readable by the MCP shim). */
  inboxForCodex: CodexMessage[]
  /** codex → DSH messages (readable by the codex_read tool). */
  inboxForDsh: CodexMessage[]
  parked: boolean
  closeTimer?: NodeJS.Timeout
  spawnAt: number
  lastOutputAt: number
}

export interface RegistryOptions {
  /** Build the process plan (tests inject a fake). */
  plan(input: SpawnInput): SpawnPlan
  /** Spawn a pty (tests inject a fake IPty). */
  spawnPty(plan: SpawnPlan, size: { cols: number; rows: number }): Promise<IPty>
  /** Called for every output chunk, after the transcript/tail were updated. */
  onData?(instance: CodexInstance, data: string): void
  now?(): number
}

export class CodexRegistry {
  private readonly bySession = new Map<string, CodexInstance>()
  private readonly byId = new Map<string, CodexInstance>()

  constructor(private readonly options: RegistryOptions) {}

  list(): CodexInstance[] {
    return [...this.byId.values()]
  }

  get(sessionId: string): CodexInstance | undefined {
    return this.bySession.get(sessionId)
  }

  getById(id: string): CodexInstance | undefined {
    return this.byId.get(id)
  }

  /**
   * Get-or-create the session's codex. A live instance is reused (and its
   * pending close cancelled) so reconnects and re-opens land on the same
   * process; an exited one is replaced.
   */
  async open(spawn: SpawnInput, size: { cols: number; rows: number }): Promise<CodexInstance> {
    const existing = this.bySession.get(spawn.sessionId)
    if (existing !== undefined && existing.state === 'running') {
      this.cancelClose(existing.id)
      existing.parked = false
      return existing
    }
    if (existing !== undefined) this.dispose(existing.id)
    return await this.create(spawn, size)
  }

  private async create(spawn: SpawnInput, size: { cols: number; rows: number }): Promise<CodexInstance> {
    const plan = this.options.plan(spawn)
    let pty: IPty
    try {
      pty = await this.options.spawnPty(plan, size)
    } catch (error) {
      // A spawn failure must not leave a half-registered instance behind.
      throw error
    }
    const now = this.options.now ?? Date.now
    const instance: CodexInstance = {
      id: spawn.instanceId,
      sessionId: spawn.sessionId,
      cwd: spawn.cwd,
      spawn,
      pty,
      transcript: '',
      tail: '',
      state: 'running',
      unread: 0,
      inboxForCodex: [],
      inboxForDsh: [],
      parked: false,
      spawnAt: now(),
      lastOutputAt: now(),
    }
    pty.onData((data: string) => {
      instance.transcript += data
      if (instance.transcript.length > TRANSCRIPT_LIMIT) {
        instance.transcript = instance.transcript.slice(instance.transcript.length - TRANSCRIPT_LIMIT)
      }
      instance.tail = (instance.tail + data).slice(-TAIL_LIMIT)
      instance.lastOutputAt = now()
      this.options.onData?.(instance, data)
    })
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      instance.state = 'exited'
      instance.exitCode = exitCode
    })
    this.bySession.set(instance.sessionId, instance)
    this.byId.set(instance.id, instance)
    return instance
  }

  /** Record a codex → DSH message (bumps the unread badge). */
  recordToDsh(instance: CodexInstance, text: string): CodexMessage {
    const message: CodexMessage = { id: randomUUID(), from: 'codex', text, at: (this.options.now ?? Date.now)() }
    instance.inboxForDsh.push(message)
    if (instance.inboxForDsh.length > INBOX_LIMIT) instance.inboxForDsh.shift()
    instance.unread += 1
    return message
  }

  /** Record a DSH → codex message (the MCP shim reads this inbox). */
  recordToCodex(instance: CodexInstance, text: string): CodexMessage {
    const message: CodexMessage = { id: randomUUID(), from: 'dsh', text, at: (this.options.now ?? Date.now)() }
    instance.inboxForCodex.push(message)
    if (instance.inboxForCodex.length > INBOX_LIMIT) instance.inboxForCodex.shift()
    return message
  }

  markSeen(sessionId: string): void {
    const instance = this.bySession.get(sessionId)
    if (instance !== undefined) instance.unread = 0
  }

  park(id: string): void {
    const instance = this.byId.get(id)
    if (instance === undefined) return
    this.cancelClose(id)
    instance.parked = true
  }

  /** Schedule destruction after `delayMs` (0 = now); `open()` cancels it. */
  scheduleClose(id: string, delayMs: number): void {
    const instance = this.byId.get(id)
    if (instance === undefined) return
    this.cancelClose(id)
    instance.closeTimer = setTimeout(() => { this.dispose(id) }, delayMs)
  }

  cancelClose(id: string): void {
    const instance = this.byId.get(id)
    if (instance?.closeTimer !== undefined) {
      clearTimeout(instance.closeTimer)
      instance.closeTimer = undefined
    }
  }

  dispose(id: string): void {
    const instance = this.byId.get(id)
    if (instance === undefined) return
    this.cancelClose(id)
    this.bySession.delete(instance.sessionId)
    this.byId.delete(id)
    try {
      instance.pty.kill()
    } catch {
      // Already gone.
    }
  }

  disposeAll(): void {
    for (const id of [...this.byId.keys()]) this.dispose(id)
  }
}

/** Production spawn: node-pty with an xterm-256color terminal. */
export async function spawnCodexPty(plan: SpawnPlan, size: { cols: number; rows: number }): Promise<IPty> {
  const nodePty = await loadNodePty()
  return nodePty.spawn(plan.file, plan.args, {
    name: 'xterm-256color',
    cols: Math.max(2, Math.floor(size.cols)),
    rows: Math.max(2, Math.floor(size.rows)),
    cwd: plan.cwd,
    env: plan.env,
  })
}

/** The production registry options. */
export function productionOptions(): RegistryOptions {
  return { plan: buildSpawnPlan, spawnPty: spawnCodexPty }
}
