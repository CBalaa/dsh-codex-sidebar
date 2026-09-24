import { describe, expect, it } from 'vitest'
import { isReadyForInjection } from '../src/readiness.ts'

const base = { lastOutputAt: 0, now: 10_000 }

describe('isReadyForInjection', () => {
  it('refuses while codex is still producing output', () => {
    const gate = isReadyForInjection({ ...base, tail: '› ', lastOutputAt: 9_900 })
    expect(gate.ready).toBe(false)
    expect(gate.reason).toContain('still producing output')
  })

  it('refuses while a trust prompt is up (our Enter would answer it)', () => {
    const gate = isReadyForInjection({
      ...base,
      tail: 'Folder access\n/wa/work\nTrust this folder?  › 1. Trust and continue',
    })
    expect(gate.ready).toBe(false)
    expect(gate.reason).toContain('Trust this folder?')
  })

  it('refuses while an approval prompt is up', () => {
    const gate = isReadyForInjection({ ...base, tail: 'Allow command? esc to cancel' })
    expect(gate.ready).toBe(false)
  })

  it('refuses before the composer exists', () => {
    const gate = isReadyForInjection({ ...base, tail: 'starting up…' })
    expect(gate.ready).toBe(false)
    expect(gate.reason).toContain('composer')
  })

  it('accepts an idle composer', () => {
    expect(isReadyForInjection({ ...base, tail: '>_ OpenAI Codex\n› Ask Codex to do anything' }).ready).toBe(true)
  })

  it('honours a custom quiet window', () => {
    const tail = '› '
    expect(isReadyForInjection({ ...base, tail, lastOutputAt: 9_900, quietMs: 50 }).ready).toBe(true)
    expect(isReadyForInjection({ ...base, tail, lastOutputAt: 9_990, quietMs: 50 }).ready).toBe(false)
  })
})
