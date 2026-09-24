/**
 * MCP stdio server spawned BY codex
 * (`-c mcp_servers.dsh.command=<node> -c mcp_servers.dsh.args=["<this file>"]`).
 *
 * Minimal newline-delimited JSON-RPC (initialize / tools/list / tools/call /
 * ping). Every tool call is forwarded to the plugin's loopback endpoint with
 * the per-instance bearer token; the shim keeps no state of its own, so it can
 * die and respawn with the codex process without losing anything.
 */
import { createInterface } from 'node:readline'

const url = process.env.DSH_CODEX_URL ?? ''
const token = process.env.DSH_CODEX_TOKEN ?? ''
const instance = process.env.DSH_CODEX_INSTANCE ?? ''

interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const TOOLS: ToolSpec[] = [
  {
    name: 'send_message',
    description:
      'Send a message to the DSH session this codex is bound to. The DSH agent is woken to read it.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Message text.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_messages',
    description: 'Read the messages DSH sent to this codex (most recent last).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max messages, default 20.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'status',
    description: 'Report the bound DSH session, working directory and codex instance state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`dsh-codex-sidebar bridge: HTTP ${String(response.status)} ${await response.text()}`)
  }
  return await response.json()
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'send_message') {
    const text = String(args.text ?? '')
    if (text.trim() === '') throw new Error('text must not be empty')
    const result = (await call('/message', {
      method: 'POST',
      body: JSON.stringify({ instance, text }),
    })) as { messageId: string }
    return `Delivered to DSH (message ${result.messageId}).`
  }
  if (name === 'read_messages') {
    const limit = typeof args.limit === 'number' ? args.limit : 20
    const result = (await call(
      `/inbox?instance=${encodeURIComponent(instance)}&limit=${String(limit)}`,
    )) as { messages: { from: string; text: string; at: number }[] }
    return result.messages.length === 0
      ? 'No messages from DSH yet.'
      : result.messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.text}`).join('\n')
  }
  if (name === 'status') {
    const result = (await call(`/status?instance=${encodeURIComponent(instance)}`)) as Record<string, unknown>
    return JSON.stringify(result)
  }
  throw new Error(`unknown tool "${name}"`)
}

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let request: { id?: number | string; method?: string; params?: Record<string, unknown> }
  try {
    request = JSON.parse(line) as typeof request
  } catch {
    return
  }
  const id = request.id ?? null
  void (async () => {
    try {
      if (request.method === 'initialize') {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: (request.params?.protocolVersion as string | undefined) ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dsh', version: '0.1.0' },
          },
        })
        return
      }
      if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') {
        return
      }
      if (request.method === 'ping') {
        send({ jsonrpc: '2.0', id, result: {} })
        return
      }
      if (request.method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
        return
      }
      if (request.method === 'tools/call') {
        const params = request.params ?? {}
        const text = await callTool(String(params.name ?? ''), (params.arguments ?? {}) as Record<string, unknown>)
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } })
        return
      }
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(request.method)}` } })
    } catch (error) {
      send({ jsonrpc: '2.0', id, error: { code: -32000, message: (error as Error).message } })
    }
  })()
})
