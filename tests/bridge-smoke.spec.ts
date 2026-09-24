/**
 * Bridge smoke test — skipped unless DSH_CODEX_SMOKE=1.
 *
 * Drives the codex → DSH path end to end WITHOUT a browser and without spending
 * a codex turn: it starts the plugin's own loopback server with a recording
 * stand-in for dsh-bridge, spawns the BUILT MCP shim as a child process exactly
 * as codex does (env only), and asserts the MCP `tools/call send_message` lands
 * as a delivery on the bound session.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLoopback } from '../src/loopback.ts'
import { CodexRegistry, type CodexInstance } from '../src/registry.ts'

const enabled = process.env.DSH_CODEX_SMOKE === '1'
const shim = join(import.meta.dirname, '..', 'lib', 'codex-mcp.js')

/** A pty stand-in: the bridge path never touches the process. */
function fakeInstance(): CodexInstance {
  const noop = (): { dispose(): void } => ({ dispose() {} })
  return {
    id: randomUUID(),
    sessionId: 'session-under-test',
    cwd: '/tmp',
    spawn: {} as CodexInstance['spawn'],
    pty: {
      onData: noop,
      onExit: noop,
      write() {},
      resize() {},
      kill() {},
    } as unknown as CodexInstance['pty'],
    transcript: '',
    tail: '',
    state: 'running',
    unread: 0,
    inboxForCodex: [],
    inboxForDsh: [],
    parked: false,
    spawnAt: Date.now(),
    lastOutputAt: Date.now(),
  }
}

describe.skipIf(!enabled)('bridge (shim -> loopback -> dsh-bridge)', () => {
  it('delivers an MCP send_message call to the bound session', async () => {
    const instance = fakeInstance()
    const seeded = new CodexRegistry({
      plan: (input) => ({ file: 'unused', args: [], env: {}, cwd: input.cwd }),
      spawnPty: async () => instance.pty,
    })
    const live = await seeded.open(
      {
        shimPath: shim,
        nodePath: process.execPath,
        sessionId: instance.sessionId,
        instanceId: instance.id,
        cwd: '/tmp',
        loopbackUrl: '',
        loopbackToken: '',
        codexPath: 'codex',
      },
      { cols: 80, rows: 24 },
    )

    const delivered: { from: string; to: string; text: string; transport?: string }[] = []
    const loopback = createLoopback({
      registry: seeded,
      deps: {
        bridge: {
          async deliverExternal(from, to, text, options) {
            delivered.push({ from, to, text, ...(options?.transport === undefined ? {} : { transport: options.transport }) })
          },
        },
      },
    })
    await loopback.ready
    const token = loopback.tokenFor(live.id)

    // Drive the shim exactly like codex does: env only, newline-delimited JSON-RPC.
    const child = spawn(process.execPath, [shim], {
      env: {
        ...process.env,
        DSH_CODEX_URL: loopback.url(),
        DSH_CODEX_TOKEN: token,
        DSH_CODEX_INSTANCE: live.id,
        DSH_CODEX_SESSION: live.sessionId,
      },
    })
    const replies: Record<string, unknown>[] = []
    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => { replies.push(JSON.parse(line) as Record<string, unknown>) })
    const send = (payload: unknown): void => { child.stdin.write(`${JSON.stringify(payload)}\n`) }

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'send_message', arguments: { text: 'BRIDGE_SMOKE_OK' } } })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && replies.length < 3) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    child.kill()
    await loopback.close()

    const byId = new Map(replies.map((reply) => [reply.id, reply]))
    const init = byId.get(1)?.result as { serverInfo?: { name?: string } } | undefined
    expect(init?.serverInfo?.name).toBe('dsh')
    const tools = (byId.get(2)?.result as { tools?: { name: string }[] } | undefined)?.tools ?? []
    expect(tools.map((tool) => tool.name)).toEqual(['send_message', 'read_messages', 'status'])
    const call = byId.get(3)?.result as { content?: { text?: string }[] } | undefined
    expect(call?.content?.[0]?.text).toContain('Delivered to DSH')

    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.to).toBe('session-under-test')
    expect(delivered[0]?.from).toBe(`codex:${live.id}`)
    expect(delivered[0]?.text).toBe('BRIDGE_SMOKE_OK')
    expect(delivered[0]?.transport).toBe('codex')
    // The unread badge counts the delivered message.
    expect(seeded.get('session-under-test')?.unread).toBe(1)
    expect(seeded.get('session-under-test')?.inboxForDsh.at(-1)?.text).toBe('BRIDGE_SMOKE_OK')
  }, 30_000)

  it('rejects a request without the instance token', async () => {
    const registry = new CodexRegistry({
      plan: (input) => ({ file: 'unused', args: [], env: {}, cwd: input.cwd }),
      spawnPty: async () => fakeInstance().pty,
    })
    const live = await registry.open(
      {
        shimPath: shim, nodePath: process.execPath, sessionId: 's', instanceId: randomUUID(),
        cwd: '/tmp', loopbackUrl: '', loopbackToken: '', codexPath: 'codex',
      },
      { cols: 80, rows: 24 },
    )
    const loopback = createLoopback({ registry, deps: {} })
    await loopback.ready
    loopback.tokenFor(live.id)

    const unauthorized = await fetch(`${loopback.url()}/status?instance=${live.id}`)
    expect(unauthorized.status).toBe(401)
    const authorized = await fetch(`${loopback.url()}/status?instance=${live.id}`, {
      headers: { authorization: `Bearer ${loopback.tokenFor(live.id)}` },
    })
    expect(authorized.status).toBe(200)
    const unknown = await fetch(`${loopback.url()}/status?instance=missing`, {
      headers: { authorization: `Bearer ${loopback.tokenFor(live.id)}` },
    })
    expect(unknown.status).toBe(404)
    await loopback.close()
  }, 20_000)
})
