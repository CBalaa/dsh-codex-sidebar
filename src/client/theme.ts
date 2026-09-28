/**
 * The xterm theme for the sidebar codex.
 *
 * Provenance: this is the same design-token approach better-sidebar's own
 * terminal uses (`src/client/TerminalView.tsx` → `theme.ts` →
 * `one-dark-palette.ts`). We keep a copy instead of importing that package —
 * the plugin must not depend on it — but the token names, the opacity floor and
 * the curated ANSI hues are deliberately identical, so the codex terminal looks
 * like the built-in terminal in both schemes instead of falling back to
 * xterm's bare defaults (which rendered unreadable inside DSH).
 */
import type { ITheme } from '@xterm/xterm'

/** one-dark syntax hues (ANSI 16 for the dark scheme). */
const ONE_DARK = {
  black: '#282c34',
  gray: '#abb2bf',
  faintGray: '#5c6370',
  white: '#ffffff',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
} as const

/** one-light syntax hues (ANSI 16 for the light scheme). */
const ONE_LIGHT = {
  black: '#383a42',
  gray: '#a0a1a7',
  faintGray: '#696c77',
  white: '#ffffff',
  offWhite: '#fafafa',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
} as const

const ANSI_DARK: ITheme = {
  black: ONE_DARK.black,
  red: ONE_DARK.red,
  green: ONE_DARK.green,
  yellow: ONE_DARK.yellow,
  blue: ONE_DARK.blue,
  magenta: ONE_DARK.magenta,
  cyan: ONE_DARK.cyan,
  white: ONE_DARK.gray,
  brightBlack: ONE_DARK.faintGray,
  brightRed: ONE_DARK.red,
  brightGreen: ONE_DARK.green,
  brightYellow: ONE_DARK.yellow,
  brightBlue: ONE_DARK.blue,
  brightMagenta: ONE_DARK.magenta,
  brightCyan: ONE_DARK.cyan,
  brightWhite: ONE_DARK.white,
}

const ANSI_LIGHT: ITheme = {
  black: ONE_LIGHT.black,
  red: ONE_LIGHT.red,
  green: ONE_LIGHT.green,
  yellow: ONE_LIGHT.yellow,
  blue: ONE_LIGHT.blue,
  magenta: ONE_LIGHT.magenta,
  cyan: ONE_LIGHT.cyan,
  white: ONE_LIGHT.gray,
  brightBlack: ONE_LIGHT.faintGray,
  brightRed: ONE_LIGHT.red,
  brightGreen: ONE_LIGHT.green,
  brightYellow: ONE_LIGHT.yellow,
  brightBlue: ONE_LIGHT.blue,
  brightMagenta: ONE_LIGHT.magenta,
  brightCyan: ONE_LIGHT.cyan,
  brightWhite: ONE_LIGHT.offWhite,
}

/** Whether the app is currently in its dark scheme. */
export function isDarkScheme(): boolean {
  if (typeof document === 'undefined') return true
  const decided = document.documentElement.style.colorScheme !== ''
  if (decided) return document.body.hasAttribute('data-ds-dark-theme')
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** One design token's computed value on <body> ('' before the theme applies). */
export function tokenValue(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

/** Minimum alpha for a token color to count as an opaque surface. */
const OPAQUE_ALPHA_MIN = 0.9

/** Alpha of a css color, or null when it does not parse as one. */
export function colorAlpha(value: string): number | null {
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (rgb !== null) {
    const parts = (rgb[1] ?? '').split(',').map((part) => part.trim())
    return parts.length === 4 ? Number(parts[3]) : 1
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex === null) return null
  const digits = hex[1] ?? ''
  if (digits.length === 4) return parseInt(`${digits[3]}${digits[3]}`, 16) / 255
  if (digits.length === 8) return parseInt(digits.slice(6, 8), 16) / 255
  return 1
}

/** A token value that is usable as a surface: present, opaque, not a keyword. */
export function effectiveTokenValue(name: string): string {
  const raw = tokenValue(name)
  switch (raw) {
    case '':
    case 'transparent':
    case 'initial':
    case 'inherit':
    case 'unset':
      return ''
    default: {
      const alpha = colorAlpha(raw)
      if (alpha !== null && alpha < OPAQUE_ALPHA_MIN) return ''
      return raw
    }
  }
}

/** The xterm theme for the current scheme (surface from tokens, ANSI curated). */
export function xtermTheme(): ITheme {
  const dark = isDarkScheme()
  const background = effectiveTokenValue('--dsw-alias-bg-base') || (dark ? '#111114' : '#ffffff')
  const foreground = effectiveTokenValue('--dsw-alias-label-primary') || (dark ? '#e6e6e6' : '#1a1a1a')
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)',
    ...(dark ? ANSI_DARK : ANSI_LIGHT),
  }
}

/** Re-run `callback` when the app flips its color scheme. */
export function subscribeColorScheme(callback: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  const observer = new MutationObserver(() => { callback() })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  return () => { observer.disconnect() }
}
