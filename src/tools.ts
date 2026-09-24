/**
 * The `codex_*` tools DSH agents call.
 *
 * Definitions are plain objects (the same shape `defineTool` compiles to) on
 * purpose: this plugin must not import a second copy of the DSH runtime packages
 * into the host process, and `tools.register()` only requires
 * `{ name, description, parameters, output: { schema, render }, execute }`.
 *
 * Instance resolution is per calling session (`exec.agent.session.id`): the
 * binding is 1:1, so a tool never has to be told which codex it means.
 */
import type { CodexInstance, CodexRegistry } from './registry.ts'
import type { HostAgent, HostToolDefinition } from './host-types.ts'
import { deliverToCodex, runCodex } from './deliver.ts'
import type { SpawnInput } from './spawn.ts'

export interface ToolDeps {
  registry: CodexRegistry
  codexPath: string
  /** Resolve (or mint) a spawn input for a session — used by codex_restart. */
  prepare(sessionId: string): Promise<{ spawn: SpawnInput }>
  /** Delivery implementation; tests inject a stub. */
  deliver?: typeof deliverToCodex
  now?(): number
}

const text = (value: string): { type: string; text: string }[] => [{ type: 'text', text: value }]

function instanceOf(deps: ToolDeps, exec: { agent?: HostAgent }): CodexInstance {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined || sessionId === '') {
    throw new Error('this tool needs an owning agent session')
  }
  const instance = deps.registry.get(sessionId)
  if (instance === undefined) {
    throw new Error(
      'no codex is bound to this session yet — open the Codex tab in the right sidebar first',
    )
  }
  return instance
}

function tailOf(instance: CodexInstance, maxChars = 1200): string {
  // Strip the ANSI control stream so the model sees text, not escape codes.
  // eslint-disable-next-line no-control-regex -- terminal control bytes are the point
  const plain = instance.tail.replace(/\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g, '')
  const trimmed = plain.trim()
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(trimmed.length - maxChars)
}

export function createCodexTools(deps: ToolDeps): HostToolDefinition[] {
  const now = deps.now ?? Date.now

  const send: HostToolDefinition = {
    name: 'codex_send',
    description:
      'Send a message to the codex session bound to this conversation (the Codex tab in the right sidebar). codex treats it as a user message and starts working on it. Fails with a readable reason when no codex is bound or codex is waiting for the human.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Message text to deliver to codex.' } },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          via: { type: 'string', description: "'queue' or 'pty'." },
          detail: { type: 'string', description: 'Runner output or the reason the queue path was skipped.' },
        },
        required: ['via'],
      },
      render: (_args, value) => text(`Delivered to codex via ${(value as { via: string }).via}.`),
    },
    async execute(args: never, exec) {
      const { text: message } = args as unknown as { text?: string }
      if (typeof message !== 'string' || message.trim() === '') throw new Error('text must not be empty')
      const instance = instanceOf(deps, exec)
      const deliver = deps.deliver ?? deliverToCodex
      const result = await deliver({ run: runCodex, now }, instance, message, deps.codexPath)
      deps.registry.recordToCodex(instance, message)
      return result
    },
  }

  const read: HostToolDefinition = {
    name: 'codex_read',
    description:
      'Read the messages codex sent to this conversation (most recent last), plus the current codex state. Messages are also delivered into the conversation automatically; this tool is for re-reading them.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximum messages, default 20.' } },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                at: { type: 'number' },
                text: { type: 'string' },
              },
              required: ['at', 'text'],
            },
          },
        },
        required: ['state', 'messages'],
      },
      render: (_args, value) => {
        const payload = value as { state: string; messages: { at: number; text: string }[] }
        if (payload.messages.length === 0) return text(`codex is ${payload.state}; no messages from codex yet.`)
        return text(
          [
            `codex is ${payload.state}; ${String(payload.messages.length)} message(s):`,
            ...payload.messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.text}`),
          ].join('\n'),
        )
      },
    },
    async execute(args: never, exec) {
      const { limit } = args as unknown as { limit?: number }
      const instance = instanceOf(deps, exec)
      const count = typeof limit === 'number' && limit > 0 ? Math.min(100, Math.floor(limit)) : 20
      return {
        state: instance.state,
        messages: instance.inboxForDsh.slice(-count).map((message) => ({ at: message.at, text: message.text })),
      }
    },
  }

  const status: HostToolDefinition = {
    name: 'codex_status',
    description:
      'Report the codex session bound to this conversation: process state, codex thread id, working directory, unread count and the tail of its terminal output.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string' },
          instanceId: { type: 'string' },
          threadId: { type: 'string' },
          cwd: { type: 'string' },
          unread: { type: 'number' },
          exitCode: { type: 'number' },
          tail: { type: 'string' },
        },
        required: ['state', 'instanceId', 'cwd', 'unread'],
      },
      render: (_args, value) => {
        const payload = value as { state: string; threadId?: string; cwd: string; tail?: string }
        return text(
          [
            `codex: ${payload.state}${payload.threadId === undefined ? '' : ` (thread ${payload.threadId})`}`,
            `cwd: ${payload.cwd}`,
            payload.tail === undefined || payload.tail === '' ? '' : `--- terminal tail ---\n${payload.tail}`,
          ]
            .filter((line) => line !== '')
            .join('\n'),
        )
      },
    },
    async execute(_args: never, exec) {
      const instance = instanceOf(deps, exec)
      return {
        state: instance.state,
        instanceId: instance.id,
        ...(instance.threadId === undefined ? {} : { threadId: instance.threadId }),
        cwd: instance.cwd,
        unread: instance.unread,
        ...(instance.exitCode === undefined ? {} : { exitCode: instance.exitCode }),
        tail: tailOf(instance),
      }
    },
  }

  const restart: HostToolDefinition = {
    name: 'codex_restart',
    description:
      'Restart the codex process bound to this conversation after it exited (same working directory and injection). A running codex is left untouched.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          restarted: { type: 'boolean' },
          state: { type: 'string' },
          instanceId: { type: 'string' },
        },
        required: ['restarted', 'state', 'instanceId'],
      },
      render: (_args, value) => {
        const payload = value as { restarted: boolean; state: string }
        return text(payload.restarted ? 'codex restarted.' : `codex is already ${payload.state}; nothing to do.`)
      },
    },
    async execute(_args: never, exec) {
      const instance = instanceOf(deps, exec)
      if (instance.state === 'running') {
        return { restarted: false, state: instance.state, instanceId: instance.id }
      }
      const prepared = await deps.prepare(instance.sessionId)
      const fresh = await deps.registry.open(
        { ...prepared.spawn, sessionId: instance.sessionId, cwd: instance.cwd },
        { cols: 80, rows: 24 },
      )
      return { restarted: true, state: fresh.state, instanceId: fresh.id }
    },
  }

  return [send, read, status, restart]
}
