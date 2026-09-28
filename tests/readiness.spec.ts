import { describe, expect, it } from 'vitest'
import { isReadyForInjection, pasteLanded, plainText } from '../src/readiness.ts'

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

describe('pasteLanded', () => {
  it('accepts an echoed paste even with ANSI cursor positioning between redraws', () => {
    const tail = '\u001b[10;3H\u001b[1m› \u001b[22mhello from DSH\u001b[?25h'
    expect(pasteLanded(tail, 'hello from DSH')).toBe(true)
  })

  it('probes only the first 32 characters, so wrapping cannot break the check', () => {
    const long = `${'x'.repeat(40)} tail that wrapped to the next line`
    expect(pasteLanded('› xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', long)).toBe(true)
  })

  it('accepts a CJK echo, which codex positions one wide char per cursor move', () => {
    // Captured live: codex echoed `这是一条中文消息` as `这 是 一 条 中 文 消 息`.
    const echo = '› ASCII_MARKER_XYZ 这 是 一 条 比 较 长 的 中 文 测 试 消 息 ， 用 来 观 察'
    expect(pasteLanded(echo, 'ASCII_MARKER_XYZ 这是一条比较长的中文测试消息，用来观察折行时的回显')).toBe(true)
  })

  it('rejects a paste a modal swallowed (nothing echoed)', () => {
    expect(pasteLanded('› 1. Trust and continue', 'hello from DSH')).toBe(false)
  })

  it('rejects an empty or whitespace-only message', () => {
    expect(pasteLanded('› ', '   ')).toBe(false)
  })
})

describe('plainText', () => {
  it('turns escape-positioned words back into readable text', () => {
    // Exactly how codex 0.156.1 paints its folder-trust modal (captured live).
    const raw = '\u001b[5;3H\u001b[22mTrust\u001b[5;9Hthis\u001b[5;14Hfolder?\u001b[9;1H\u001b[7m\u001b[1m› 1. Trust and continue'
    expect(plainText(raw)).toBe('Trust this folder? › 1. Trust and continue')
  })

  it('drops OSC title sequences and simple escapes', () => {
    expect(plainText('\u001b[1;1H\u001b[2mhi\u001b[0m \u001b]0;title\u0007there')).toBe('hi there')
  })

  it('collapses the redraw whitespace so markers stay matchable', () => {
    expect(plainText('›   \u001b[?25h  Ask Codex')).toBe('› Ask Codex')
  })
})

describe('isReadyForInjection on the raw stream', () => {
  it('detects the folder-trust modal even though codex draws each word with a cursor move', () => {
    const raw =
      '\u001b[2;1H\u001b[1m  Folder access\u001b[5;3H\u001b[22mTrust\u001b[5;9Hthis\u001b[5;14Hfolder?\u001b[9;1H\u001b[7m› 1. Trust and continue'
    const gate = isReadyForInjection({ tail: raw, lastOutputAt: 0, now: 10_000 })
    expect(gate.ready).toBe(false)
    expect(gate.reason).toContain('Trust this folder?')
  })
})
