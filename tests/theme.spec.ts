import { describe, expect, it } from 'vitest'
import { colorAlpha, effectiveTokenValue, isDarkScheme, xtermTheme } from '../src/client/theme.ts'

/**
 * Node has no `document`, which is exactly the "before the app theme applies"
 * state: the theme must still produce a readable pair of surface colors rather
 * than xterm's bare defaults (the bug that made the terminal unreadable in DSH).
 */
describe('xtermTheme outside a browser', () => {
  it('falls back to a readable dark palette', () => {
    const theme = xtermTheme()
    expect(theme.background).toBe('#111114')
    expect(theme.foreground).toBe('#e6e6e6')
    expect(theme.cursor).toBe('#e6e6e6')
    expect(theme.black).toBe('#282c34')
    expect(theme.brightWhite).toBe('#ffffff')
    expect(isDarkScheme()).toBe(true)
  })

  it('has a distinct foreground and background', () => {
    const theme = xtermTheme()
    expect(theme.foreground).not.toBe(theme.background)
  })
})

describe('colorAlpha', () => {
  it('reads alpha from named forms', () => {
    expect(colorAlpha('rgba(0,0,0,0.16)')).toBeCloseTo(0.16)
    expect(colorAlpha('rgb(1,2,3)')).toBe(1)
    expect(colorAlpha('#11223344')).toBeCloseTo(0x44 / 255)
    expect(colorAlpha('#fff8')).toBeCloseTo(0x88 / 255)
    expect(colorAlpha('#ffffff')).toBe(1)
  })

  it('returns null for values it cannot parse', () => {
    expect(colorAlpha('var(--x)')).toBeNull()
    expect(colorAlpha('red')).toBeNull()
  })
})

describe('effectiveTokenValue', () => {
  it('treats unset tokens as empty', () => {
    expect(effectiveTokenValue('--dsw-alias-bg-base')).toBe('')
  })
})
