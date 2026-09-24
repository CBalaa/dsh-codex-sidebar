import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  discoverThreadIdFromRollouts,
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

describe('discoverThreadIdFromRollouts', () => {
  it('returns the newest rollout written after the spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-rollouts-'))
    const nested = join(root, '2026', '09', '24')
    await mkdir(nested, { recursive: true })
    const old = '01a0d000-0000-7000-8000-000000000001'
    await writeFile(join(nested, `rollout-2026-09-23T00-00-00-${old}.jsonl`), '{}')
    const fresh = '01a0d000-0000-7000-8000-000000000002'
    await writeFile(join(nested, `rollout-2026-09-24T17-00-00-${fresh}.jsonl`), '{}')

    const spawnedAt = Date.now() - 1000
    expect(await discoverThreadIdFromRollouts({ sessionsDir: root, spawnedAt })).toBe(fresh)
    // A spawn after every file means "no rollout yet".
    expect(await discoverThreadIdFromRollouts({ sessionsDir: root, spawnedAt: Date.now() + 60_000 })).toBeUndefined()
    // A missing directory is not an error.
    expect(await discoverThreadIdFromRollouts({ sessionsDir: join(root, 'nope'), spawnedAt: 0 })).toBeUndefined()
  })
})
