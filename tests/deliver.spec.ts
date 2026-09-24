import { describe, expect, it } from 'vitest'
import { deliverToCodex, type RunResult } from '../src/deliver.ts'
import type { CodexInstance } from '../src/registry.ts'

const THREAD = '01a0d296-2962-7fb1-917c-247c9f3ce1ab'

interface Writes {
  chunks: string[]
}

function instance(overrides: Partial<CodexInstance> = {}, writes: Writes = { chunks: [] }): CodexInstance {
  return {
    id: 'instance-1',
    sessionId: 'session-1',
    cwd: '/work',
    spawn: {} as CodexInstance['spawn'],
    pty: {
      onData: () => ({ dispose() {} }),
      onExit: () => ({ dispose() {} }),
      write: (data: string) => { writes.chunks.push(data) },
      resize() {},
      kill() {},
    } as unknown as CodexInstance['pty'],
    transcript: '',
    tail: '>_ OpenAI Codex\n› Ask Codex to do anything',
    state: 'running',
    unread: 0,
    inboxForCodex: [],
    inboxForDsh: [],
    parked: false,
    spawnAt: 0,
    lastOutputAt: 0,
    ...overrides,
  }
}

const immediate = { sleep: async () => undefined }

describe('deliverToCodex', () => {
  it('uses `codex queue` when the thread id is known', async () => {
    const calls: string[][] = []
    const writes: Writes = { chunks: [] }
    const result = await deliverToCodex(
      {
        ...immediate,
        now: () => 10_000,
        run: async (_command, args): Promise<RunResult> => {
          calls.push(args)
          return { code: 0, stdout: 'Queued message', stderr: '' }
        },
      },
      instance({ threadId: THREAD }, writes),
      'hello codex',
      '/usr/bin/codex',
    )
    expect(result.via).toBe('queue')
    expect(calls).toEqual([['queue', '--thread', THREAD, '--message', 'hello codex']])
    expect(writes.chunks).toEqual([])
  })

  it('falls back to a gated bracketed paste when the queue path fails', async () => {
    const writes: Writes = { chunks: [] }
    const result = await deliverToCodex(
      {
        ...immediate,
        now: () => 10_000,
        run: async (): Promise<RunResult> => ({ code: 1, stdout: '', stderr: 'no rollout found' }),
      },
      instance({ threadId: THREAD }, writes),
      'hello codex',
      '/usr/bin/codex',
    )
    expect(result.via).toBe('pty')
    expect(result.detail).toContain('no rollout found')
    // Bracketed paste, then Enter.
    expect(writes.chunks[0]).toBe('\u001b[200~hello codex\u001b[201~')
    expect(writes.chunks[1]).toBe('\r')
  })

  it('skips the queue entirely before the first turn (no thread id)', async () => {
    const writes: Writes = { chunks: [] }
    let ran = false
    const result = await deliverToCodex(
      {
        ...immediate,
        now: () => 10_000,
        run: async (): Promise<RunResult> => {
          ran = true
          return { code: 0, stdout: '', stderr: '' }
        },
      },
      instance({}, writes),
      'first message',
      '/usr/bin/codex',
    )
    expect(ran).toBe(false)
    expect(result.via).toBe('pty')
    expect(result.detail).toContain('no codex thread id yet')
  })

  it('never writes into a blocking modal and reports why', async () => {
    const writes: Writes = { chunks: [] }
    const clock = { t: 10_000 }
    await expect(
      deliverToCodex(
        {
          now: () => clock.t,
          sleep: async (ms) => { clock.t += ms },
          waitMs: 1000,
          run: async (): Promise<RunResult> => ({ code: 1, stdout: '', stderr: 'nope' }),
        },
        instance({ threadId: THREAD, tail: 'Trust this folder? › 1. Trust and continue' }, writes),
        'hello',
        '/usr/bin/codex',
      ),
    ).rejects.toThrow(/Trust this folder\?/)
    expect(writes.chunks).toEqual([])
  })

  it('times out with a readable reason instead of typing blindly', async () => {
    const writes: Writes = { chunks: [] }
    let clock = 0
    await expect(
      deliverToCodex(
        {
          sleep: async (ms) => { clock += ms },
          now: () => clock,
          waitMs: 1000,
          run: async (): Promise<RunResult> => ({ code: 1, stdout: '', stderr: 'nope' }),
        },
        instance({ threadId: THREAD, tail: 'still booting' }, writes),
        'hello',
        '/usr/bin/codex',
      ),
    ).rejects.toThrow(/composer is not visible yet/)
    expect(writes.chunks).toEqual([])
  })

  it('refuses to deliver into a dead process', async () => {
    await expect(
      deliverToCodex(
        { ...immediate, now: () => 10_000, run: async (): Promise<RunResult> => ({ code: 1, stdout: '', stderr: 'x' }) },
        instance({ threadId: THREAD, state: 'exited' }),
        'hello',
        '/usr/bin/codex',
      ),
    ).rejects.toThrow(/not running/)
  })
})
