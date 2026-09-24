/**
 * dsh-codex-sidebar — host half.
 *
 * Owns: the codex instance registry (the only codex-process owner in this
 * host), the `/codex-sidebar/ws` terminal transport, the loopback bridge the
 * MCP shim talks to, and the `codex_*` DSH tools.
 *
 * Everything DSH-specific is reached through `ctx.get(...)` structural mirrors
 * (src/host-types.ts) so the plugin never imports a second copy of the DSH
 * runtime packages, and a host that lacks an optional service degrades with a
 * readable error instead of failing at import time.
 */
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  HostAgents,
  HostBridge,
  HostContext,
  HostLogger,
  HostSessionPersistence,
  HostWebRuntime,
} from './host-types.ts'
import { createLoopback } from './loopback.ts'
import { CodexRegistry, productionOptions } from './registry.ts'
import type { SpawnInput } from './spawn.ts'
import { createCodexTools } from './tools.ts'
import { isTrustedRequest } from './trust-fence.ts'
import { createCodexHttp } from './http.ts'
import { threadIdFromTranscript } from './thread-id.ts'
import { createCodexWs } from './ws.ts'

export const name = 'dsh-codex-sidebar'
export const inject = ['webServer', 'tools']

/** The directory holding this plugin's built files (lib/). */
function pluginRoot(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/** Resolve the codex executable from the host's own PATH. */
export function resolveCodex(pathValue: string = process.env.PATH ?? ''): string {
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Keep looking.
    }
  }
  throw new Error('codex executable not found on PATH (install codex-cli or put it on the DSH host PATH)')
}

/**
 * The user's own `developer_instructions`, when their ~/.codex/config.toml sets
 * one. We APPEND it after our identity text rather than letting `-c` clobber
 * it. A minimal top-level TOML scan is enough here: the value is a single-line
 * string, and anything more exotic is left alone (the key then simply is not
 * appended, and our injection still stands).
 */
export function userDeveloperInstructions(configPath = join(homedir(), '.codex', 'config.toml')): string | undefined {
  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    return undefined
  }
  let table: string | null = null
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) {
      table = trimmed
      continue
    }
    if (table !== null) continue
    const match = /^developer_instructions\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/.exec(trimmed)
    if (match === null) continue
    const raw = match[1] ?? ''
    const value = raw.startsWith("'") ? raw.slice(1, -1) : (JSON.parse(raw) as string)
    return value === '' ? undefined : value
  }
  return undefined
}

interface HostSessions {
  get(id: string): { header?: { cwd?: string } } | undefined
}

/** Session cwd: live header first, then the client hint, then the persisted header. */
export async function sessionCwdOf(host: HostContext, sessionId: string, hint?: string): Promise<string> {
  const sessions = host.get('sessions') as HostSessions | undefined
  const live = sessions?.get(sessionId)?.header?.cwd
  if (typeof live === 'string' && live !== '') return live
  if (hint !== undefined && hint !== '') return hint
  const persistence = host.get('sessionPersistence') as HostSessionPersistence | undefined
  if (persistence !== undefined) {
    const handle = await persistence.open(sessionId, 'read')
    try {
      const cwd = handle.header.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } finally {
      await handle.close()
    }
  }
  return process.cwd()
}

export function apply(ctx: Context): void {
  const host = ctx as unknown as HostContext
  const log: HostLogger | undefined = host.logger?.('dsh-codex-sidebar')
  const registry = new CodexRegistry({
    ...productionOptions(),
    // codex prints its own session UUID in the TUI status line; capturing it
    // here is what makes the clean `codex queue` delivery path available.
    onData: (instance) => {
      if (instance.threadId !== undefined) return
      const discovered = threadIdFromTranscript(instance.transcript)
      if (discovered !== undefined) instance.threadId = discovered
    },
  })
  const loopback = createLoopback({
    registry,
    deps: {
      bridge: host.get('dshBridge') as HostBridge | undefined,
      agents: host.get('agents') as HostAgents | undefined,
      log,
    },
  })

  const codexPath = resolveCodex()
  const shimPath = join(pluginRoot(), 'codex-mcp.js')
  const trustedHosts = (): readonly string[] =>
    (host.get('webRuntime') as HostWebRuntime | undefined)?.trustedHosts ?? []
  /** Resolve (or mint) the spawn input for a session; shared by WS and API. */
  const prepare = async (sessionId: string, hint?: string): Promise<{ spawn: SpawnInput; cwd: string }> => {
    await loopback.ready
    const cwd = await sessionCwdOf(host, sessionId, hint)
    const instanceId = randomUUID()
    const instructions = userDeveloperInstructions()
    const spawn: SpawnInput = {
      shimPath,
      nodePath: process.execPath,
      sessionId,
      instanceId,
      cwd,
      loopbackUrl: loopback.url(),
      loopbackToken: loopback.tokenFor(instanceId),
      codexPath,
      ...(instructions === undefined ? {} : { userDeveloperInstructions: instructions }),
    }
    return { spawn, cwd }
  }

  const ws = createCodexWs({
    registry,
    isTrusted: (req) => isTrustedRequest(req, trustedHosts()),
    onError: (message) => { log?.error(message) },
    prepare,
  })
  const http = createCodexHttp({
    registry,
    isTrusted: (req) => isTrustedRequest(req, trustedHosts()),
    onError: (message) => { log?.error(message) },
    prepare: async (sessionId) => await prepare(sessionId),
  })

  ctx.effect(() => host.webServer.register({ kind: 'prefix', path: '/codex-sidebar/api', handler: http.handle }))
  ctx.effect(() => host.webServer.registerUpgrade({ path: '/codex-sidebar/ws', handler: ws.handleUpgrade }))

  for (const definition of createCodexTools({
    registry,
    codexPath,
    prepare: async (sessionId) => await prepare(sessionId),
  })) {
    ctx.effect(() => host.tools.register(definition))
  }
  ctx.effect(() => () => {
    ws.close()
    registry.disposeAll()
    void loopback.close()
  })

  log?.info(`ready (codex: ${codexPath}, bridge: ${loopback.url() || 'pending'})`)
}
