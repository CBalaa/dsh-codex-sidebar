import { describe, expect, it } from 'vitest'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { createCodexTools } from '../src/tools.ts'
import { CodexRegistry, type CodexInstance } from '../src/registry.ts'

/**
 * The tool contract is enforced by DSH's own registry validator, so these tests
 * run the REAL validator. They exist because a hand-written output schema in the
 * wrong dialect (`required: true` inside a property) makes `tools.register()`
 * throw and takes the whole plugin fiber down.
 */
function instance(overrides: Partial<CodexInstance> = {}): CodexInstance {
  return {
    id: 'instance-1',
    sessionId: 'session-1',
    cwd: '/work/repo',
    spawn: {} as CodexInstance['spawn'],
    pty: {
      onData: () => ({ dispose() {} }),
      onExit: () => ({ dispose() {} }),
      write() {},
      resize() {},
      kill() {},
    } as unknown as CodexInstance['pty'],
    transcript: '',
    tail: '',
    state: 'running',
    unread: 2,
    inboxForCodex: [],
    inboxForDsh: [{ id: 'm1', from: 'codex', text: 'from codex', at: 1 }],
    parked: false,
    spawnAt: 0,
    lastOutputAt: 0,
    ...overrides,
  }
}

function deps(overrides: Partial<Parameters<typeof createCodexTools>[0]> = {}) {
  const registry = new CodexRegistry({
    plan: (input) => ({ file: 'unused', args: [], env: {}, cwd: input.cwd }),
    spawnPty: async () => instance().pty,
  })
  return {
    registry,
    codexPath: '/usr/bin/codex',
    prepare: async () => ({ spawn: {} as never }),
    ...overrides,
  }
}

const exec = { agent: { session: { id: 'session-1' }, followup() {} } }

describe('codex tools', () => {
  it('exposes the four documented tools with valid DSH schemas', () => {
    const tools = createCodexTools(deps())
    expect(tools.map((tool) => tool.name)).toEqual(['codex_send', 'codex_read', 'codex_status', 'codex_restart'])
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(() => { assertSupportedJsonSchema(tool.parameters) }).not.toThrow()
      expect(() => { assertSupportedJsonSchema(tool.output.schema) }).not.toThrow()
      expect(typeof tool.output.render).toBe('function')
    }
  })

  it('reports a readable error when no codex is bound to the session', async () => {
    const tools = createCodexTools(deps())
    const status = tools.find((tool) => tool.name === 'codex_status')
    await expect(status?.execute(undefined as never, exec)).rejects.toThrow(/open the Codex tab/)
  })

  it('rejects an empty message before touching codex', async () => {
    const tools = createCodexTools(deps())
    const send = tools.find((tool) => tool.name === 'codex_send')
    await expect(send?.execute({ text: '   ' } as never, exec)).rejects.toThrow(/must not be empty/)
  })

  it('codex_send routes through the delivery strategy and records the outbound message', async () => {
    const calls: { text: string }[] = []
    const d = deps({
      deliver: (async (_deps: unknown, _instance: unknown, text: string) => {
        calls.push({ text })
        return { via: 'queue' as const }
      }) as never,
    })
    await d.registry.open(
      {
        shimPath: 's', nodePath: 'n', sessionId: 'session-1', instanceId: 'instance-1',
        cwd: '/work/repo', loopbackUrl: 'u', loopbackToken: 't', codexPath: 'codex',
      },
      { cols: 80, rows: 24 },
    )
    const tools = createCodexTools(d)
    const send = tools.find((tool) => tool.name === 'codex_send')
    const result = await send?.execute({ text: 'review this' } as never, exec)
    expect(result).toEqual({ via: 'queue' })
    expect(calls).toEqual([{ text: 'review this' }])
    expect(d.registry.get('session-1')?.inboxForCodex.at(-1)?.text).toBe('review this')
  })

  it('codex_read returns the codex → DSH inbox', async () => {
    const d = deps()
    const opened = await d.registry.open(
      {
        shimPath: 's', nodePath: 'n', sessionId: 'session-1', instanceId: 'instance-1',
        cwd: '/work/repo', loopbackUrl: 'u', loopbackToken: 't', codexPath: 'codex',
      },
      { cols: 80, rows: 24 },
    )
    d.registry.recordToDsh(opened, 'from codex')
    const tools = createCodexTools(d)
    const read = tools.find((tool) => tool.name === 'codex_read')
    const result = (await read?.execute({ limit: 5 } as never, exec)) as { state: string; messages: unknown[] }
    expect(result.state).toBe('running')
    expect(result.messages).toHaveLength(1)
  })

  it('codex_status strips ANSI escapes from the terminal tail', async () => {
    const d = deps()
    const opened = await d.registry.open(
      {
        shimPath: 's', nodePath: 'n', sessionId: 'session-1', instanceId: 'instance-1',
        cwd: '/work/repo', loopbackUrl: 'u', loopbackToken: 't', codexPath: 'codex',
      },
      { cols: 80, rows: 24 },
    )
    opened.tail = '\u001b[1;1H\u001b[2mhello\u001b[0m \u001b]0;title\u0007world'
    const tools = createCodexTools(d)
    const status = tools.find((tool) => tool.name === 'codex_status')
    const result = (await status?.execute(undefined as never, exec)) as { tail: string }
    expect(result.tail).toBe('hello world')
  })
})
