import { describe, expect, it } from 'vitest'
import { BUFFER_LIMIT, OutputGate, hasUsableSize } from '../src/client/terminal-gate.ts'

/**
 * Regression guard for the "black window after refresh" bug: a replay written
 * into a pre-layout terminal (12x3 observed) wraps the TUI frames into garbage
 * that a later resize cannot undo.
 */
describe('hasUsableSize', () => {
  it('rejects pre-layout geometries', () => {
    expect(hasUsableSize(12, 3)).toBe(false)
    expect(hasUsableSize(0, 0)).toBe(false)
    expect(hasUsableSize(29, 24)).toBe(false)
  })

  it('accepts a laid-out panel', () => {
    expect(hasUsableSize(30, 6)).toBe(true)
    expect(hasUsableSize(80, 24)).toBe(true)
  })
})

describe('OutputGate', () => {
  it('holds every chunk until the geometry is usable, then flushes in order', () => {
    const written: string[] = []
    const gate = new OutputGate((data) => written.push(data))
    gate.push('first')
    gate.push('second')
    expect(written).toEqual([])
    expect(gate.ready).toBe(false)

    expect(gate.size(12, 3)).toBe(false)
    expect(written).toEqual([])

    expect(gate.size(80, 24)).toBe(true)
    expect(written).toEqual(['first', 'second'])
    expect(gate.ready).toBe(true)
    // Later sizes are ordinary resizes, not a second flush signal.
    expect(gate.size(100, 30)).toBe(false)
  })

  it('writes straight through once open', () => {
    const written: string[] = []
    const gate = new OutputGate((data) => written.push(data))
    gate.size(80, 24)
    gate.push('live')
    expect(written).toEqual(['live'])
  })

  it('bounds the buffer while the panel stays unlaid-out', () => {
    const written: string[] = []
    const gate = new OutputGate((data) => written.push(data))
    const chunk = 'x'.repeat(1 << 20)
    for (let i = 0; i < 4; i += 1) gate.push(chunk)
    expect(gate.buffered).toBeLessThanOrEqual(BUFFER_LIMIT)
    gate.size(80, 24)
    expect(written.join('').length).toBeLessThanOrEqual(BUFFER_LIMIT)
  })
})
