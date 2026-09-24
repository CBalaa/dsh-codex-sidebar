/**
 * The loopback bridge the codex-side MCP shim talks to.
 *
 * Why not a route on the DSH webserver: `dsh-auth-gate` wraps EVERY route and
 * upgrade the webserver exposes (src/gate/guard.ts wraps existing + future
 * registrations), so a headless MCP server inside codex could never pass its
 * authentication. Instead this plugin runs its own server bound to 127.0.0.1 on
 * an OS-assigned port, with a per-instance bearer token handed to the shim
 * through the spawn environment (never in argv, never on disk).
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { CodexInstance, CodexRegistry } from './registry.ts'
import { deliverToDsh, type DeliverToDshDeps } from './to-dsh.ts'

export interface LoopbackHandle {
  /** Base URL, e.g. http://127.0.0.1:41234 (resolves once listening). */
  url(): string
  /** Whether the server is listening (spawn preparation awaits `ready`). */
  ready: Promise<void>
  tokenFor(instanceId: string): string
  close(): Promise<void>
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

export function createLoopback(input: { registry: CodexRegistry; deps: DeliverToDshDeps }): LoopbackHandle {
  const tokens = new Map<string, string>()
  let base = ''

  const instanceOf = (id: unknown): CodexInstance | undefined =>
    typeof id === 'string' && id !== '' ? input.registry.getById(id) : undefined

  const authorized = (req: IncomingMessage, instance: CodexInstance | undefined): boolean => {
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const presented = header.slice('Bearer '.length)
    const expected = instance === undefined ? undefined : tokens.get(instance.id)
    return expected !== undefined && expected === presented
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const instanceId = url.searchParams.get('instance') ?? undefined
      let body: Record<string, unknown> = {}
      if (req.method === 'POST') {
        const parsed = await readBody(req)
        if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
          json(res, 400, { error: 'invalid JSON body' })
          return
        }
        body = parsed as Record<string, unknown>
      }
      const instance = instanceOf(req.method === 'POST' ? (body.instance ?? instanceId) : instanceId)
      if (instance === undefined) {
        json(res, 404, { error: 'unknown codex instance' })
        return
      }
      if (!authorized(req, instance)) {
        json(res, 401, { error: 'unauthorized' })
        return
      }

      if (req.method === 'POST' && url.pathname === '/message') {
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') {
          json(res, 400, { error: 'text must not be empty' })
          return
        }
        try {
          await deliverToDsh(input.deps, instance, text)
        } catch (error) {
          json(res, 502, { error: (error as Error).message })
          return
        }
        const message = input.registry.recordToDsh(instance, text)
        json(res, 200, { ok: true, messageId: message.id })
        return
      }

      if (req.method === 'GET' && url.pathname === '/inbox') {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '20') || 20))
        json(res, 200, { messages: instance.inboxForCodex.slice(-limit) })
        return
      }

      if (req.method === 'GET' && url.pathname === '/status') {
        json(res, 200, {
          instanceId: instance.id,
          sessionId: instance.sessionId,
          cwd: instance.cwd,
          state: instance.state,
          threadId: instance.threadId ?? null,
        })
        return
      }

      json(res, 404, { error: 'not found' })
    })().catch((error: unknown) => {
      json(res, 500, { error: (error as Error).message })
    })
  })

  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('loopback server did not bind a TCP port'))
        return
      }
      base = `http://127.0.0.1:${String(address.port)}`
      resolve()
    })
  })

  return {
    ready,
    url: () => base,
    tokenFor(instanceId: string): string {
      const existing = tokens.get(instanceId)
      if (existing !== undefined) return existing
      const token = randomBytes(32).toString('hex')
      tokens.set(instanceId, token)
      return token
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => {
        for (const instance of input.registry.list()) tokens.delete(instance.id)
        server.close(() => { resolve() })
        server.closeAllConnections()
      })
    },
  }
}
