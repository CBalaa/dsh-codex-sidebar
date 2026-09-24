/**
 * The browser-facing JSON API for the sidebar tab (fenced like the WS route).
 *
 *   GET  /codex-sidebar/api/state?sessionId=   -> instance status + unread count
 *   POST /codex-sidebar/api/seen               -> clear the unread badge
 *   POST /codex-sidebar/api/restart            -> respawn an exited codex
 *   POST /codex-sidebar/api/kill               -> explicit stop (the tab's toolbar)
 *
 * Every route passes `isTrustedRequest` before doing anything: this API can kill
 * and respawn processes, so a cross-site caller must never reach it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CodexRegistry } from './registry.ts'
import type { SpawnInput } from './spawn.ts'

export interface HttpDeps {
  registry: CodexRegistry
  isTrusted(req: IncomingMessage): boolean
  /** Resolve the spawn input for a session (same path the WS uses). */
  prepare(sessionId: string): Promise<{ spawn: SpawnInput }>
  onError?(message: string): void
}

export interface HttpHandle {
  handle(req: IncomingMessage, res: ServerResponse): void
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function createCodexHttp(deps: HttpDeps): HttpHandle {
  return {
    handle(req, res) {
      void (async () => {
        if (!deps.isTrusted(req)) {
          json(res, 403, { error: 'forbidden' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const querySession = url.searchParams.get('sessionId') ?? ''
        const body = req.method === 'POST' ? await readBody(req) : {}
        const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : querySession

        if (req.method === 'GET' && url.pathname === '/codex-sidebar/api/state') {
          if (sessionId === '') {
            json(res, 400, { error: 'sessionId is required' })
            return
          }
          const instance = deps.registry.get(sessionId)
          json(res, 200, {
            bound: instance !== undefined,
            instanceId: instance?.id ?? null,
            state: instance?.state ?? 'none',
            threadId: instance?.threadId ?? null,
            cwd: instance?.cwd ?? null,
            unread: instance?.unread ?? 0,
            exitCode: instance?.exitCode ?? null,
          })
          return
        }

        if (req.method === 'POST' && url.pathname === '/codex-sidebar/api/seen') {
          if (sessionId !== '') deps.registry.markSeen(sessionId)
          json(res, 200, { ok: true })
          return
        }

        if (req.method === 'POST' && url.pathname === '/codex-sidebar/api/restart') {
          const instance = deps.registry.get(sessionId)
          if (instance === undefined) {
            json(res, 404, { error: 'no codex is bound to this session' })
            return
          }
          if (instance.state === 'running') {
            json(res, 200, { ok: true, restarted: false, state: instance.state })
            return
          }
          const prepared = await deps.prepare(sessionId)
          const fresh = await deps.registry.open(
            { ...prepared.spawn, sessionId, cwd: instance.cwd },
            { cols: 80, rows: 24 },
          )
          json(res, 200, { ok: true, restarted: true, instanceId: fresh.id })
          return
        }

        if (req.method === 'POST' && url.pathname === '/codex-sidebar/api/kill') {
          const instance = deps.registry.get(sessionId)
          if (instance === undefined) {
            json(res, 404, { error: 'no codex is bound to this session' })
            return
          }
          deps.registry.dispose(instance.id)
          json(res, 200, { ok: true })
          return
        }

        json(res, 404, { error: 'not found' })
      })().catch((error: unknown) => {
        const message = (error as Error).message
        deps.onError?.(message)
        json(res, 500, { error: message })
      })
    },
  }
}
