import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  discoverThreadIdFromRollouts,
  parseRolloutMeta,
  threadIdFromRolloutName,
  threadIdFromTranscript,
} from '../src/thread-id.ts'

const ID = '01a0d296-2962-7fb1-917c-247c9f3ce1ab'

describe('threadIdFromTranscript', () => {
  it('finds the codex session UUID in a TUI status line', () => {
    const transcript = `>_ OpenAI Codex (v0.156.1)\r\n… status line · ${ID} · ⚠ 1 warning\r\n`
    expect(threadIdFromTranscript(transcript)).toBe(ID)
  })

  it('takes the last match (the status line is redrawn)', () => {
    const other = '01a0d297-ec55-77c2-b8e1-57f92389d4ab'
    expect(threadIdFromTranscript(`${ID} … redraw … ${other}`)).toBe(other)
  })

  it('uppercases are normalised and UUIDv4-shaped ids are ignored', () => {
    expect(threadIdFromTranscript(ID.toUpperCase())).toBe(ID)
    expect(threadIdFromTranscript('01a0d296-2962-4fb1-917c-247c9f3ce1ab')).toBeUndefined()
  })

  it('returns undefined without a match', () => {
    expect(threadIdFromTranscript('nothing here')).toBeUndefined()
  })
})

describe('threadIdFromRolloutName', () => {
  it('extracts the UUID from a rollout file name', () => {
    expect(threadIdFromRolloutName(`rollout-2026-09-24T17-00-00-${ID}.jsonl`)).toBe(ID)
  })

  it('ignores unrelated names', () => {
    expect(threadIdFromRolloutName('history.jsonl')).toBeUndefined()
    expect(threadIdFromRolloutName(`rollout-${ID}.txt`)).toBeUndefined()
  })
})

describe('parseRolloutMeta', () => {
  it('reads the session_meta line codex writes first', () => {
    const line = JSON.stringify({
      timestamp: '2026-09-28T02:35:49.012Z',
      type: 'session_meta',
      payload: { id: '01a0e5de-1133-7003-9f7c-b0a1d40aa998', cwd: '/wafer/work', source: 'cli' },
    })
    const meta = parseRolloutMeta(line)
    expect(meta?.cwd).toBe('/wafer/work')
    expect(meta?.id).toBe('01a0e5de-1133-7003-9f7c-b0a1d40aa998')
  })

  it('rejects a malformed or non-meta line', () => {
    expect(parseRolloutMeta('not json')).toBeUndefined()
    expect(parseRolloutMeta(JSON.stringify({ type: 'turn', payload: {} }))).toBeUndefined()
  })
})

describe('discoverThreadIdFromRollouts', () => {
  const MINE = '01a0e5de-1133-7003-9f7c-b0a1d40aa998'
  const OTHER_REPO = '01a0d244-53e4-7ca0-97ef-570baf602c12'
  const SUBAGENT = '01a0e5dd-3d2c-7381-90e2-59acb2e581c0'
  const OLD = '01a0d000-0000-7000-8000-000000000001'

  function metaLine(id: string, cwd: string, source: unknown): string {
    return `${JSON.stringify({ timestamp: 'x', type: 'session_meta', payload: { id, cwd, source, originator: 'codex-tui' } })}\n`
  }

  /** A sessions tree with explicit mtimes, relative to `Date.now()`. */
  async function fixture(
    files: { name: string; id: string; cwd: string; source?: unknown; agoMs: number }[],
  ): Promise<{ root: string; now: number }> {
    const root = await mkdtemp(join(tmpdir(), 'codex-rollouts-'))
    const nested = join(root, '2026', '09', '28')
    await mkdir(nested, { recursive: true })
    const now = Date.now()
    for (const file of files) {
      const target = join(nested, `rollout-${file.name}-${file.id}.jsonl`)
      await writeFile(target, metaLine(file.id, file.cwd, file.source ?? 'cli'))
      const at = new Date(now - file.agoMs)
      await utimes(target, at, at)
    }
    return { root, now }
  }

  it('finds this instance rollout by cwd, rejecting other repos and subagents', async () => {
    const { root, now } = await fixture([
      { name: 'old', id: OLD, cwd: '/wafer/work', agoMs: 600_000 },
      { name: 'other-repo', id: OTHER_REPO, cwd: '/other/repo', agoMs: 30_000 },
      { name: 'mine', id: MINE, cwd: '/wafer/work', agoMs: 20_000 },
      { name: 'subagent', id: SUBAGENT, cwd: '/wafer/work', source: { subagent: {} }, agoMs: 10_000 },
    ])
    const found = await discoverThreadIdFromRollouts({
      sessionsDir: root,
      spawnedAt: now - 60_000,
      cwd: '/wafer/work',
    })
    expect(found).toBe(MINE)
  })

  it('refuses an ambiguous set instead of queueing into the wrong codex session', async () => {
    const second = '01a0e5de-1133-7003-9f7c-b0a1d40aa999'
    const { root, now } = await fixture([
      { name: 'a', id: MINE, cwd: '/wafer/work', agoMs: 20_000 },
      { name: 'b', id: second, cwd: '/wafer/work', agoMs: 19_500 },
    ])
    expect(
      await discoverThreadIdFromRollouts({ sessionsDir: root, spawnedAt: now - 60_000, cwd: '/wafer/work' }),
    ).toBeUndefined()
  })

  it('ignores rollouts written before this instance spawned, and missing dirs', async () => {
    const { root, now } = await fixture([{ name: 'mine', id: MINE, cwd: '/wafer/work', agoMs: 120_000 }])
    expect(
      await discoverThreadIdFromRollouts({ sessionsDir: root, spawnedAt: now - 60_000, cwd: '/wafer/work' }),
    ).toBeUndefined()
    expect(await discoverThreadIdFromRollouts({ sessionsDir: join(root, 'nope'), spawnedAt: 0 })).toBeUndefined()
  })
})
