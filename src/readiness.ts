/**
 * The readiness gate for pty injection (spec §4.6).
 *
 * Writing keystrokes into a TUI is only safe when codex is sitting at its
 * composer. If a modal is up (the folder trust prompt, an approval prompt) our
 * `Enter` would answer that modal instead of submitting a message — so the gate
 * refuses and the caller keeps the message pending with a readable reason.
 *
 * The composer marker `›` was observed live in codex 0.156.1 (see
 * tests/pty-smoke.spec.ts); every marker here is a heuristic on purpose, and a
 * failed heuristic degrades to "message stays pending", never to a wrong Enter.
 */

/** Markers that mean codex is waiting for the human, not for a message. */
export const BLOCK_MARKERS = [
  'Trust this folder?',
  'Do you trust the contents of this directory',
  'Press enter to continue',
  'esc to cancel',
  'Allow command?',
] as const

/** The composer prompt codex paints when it is ready for input. */
export const COMPOSER_MARKER = '›'

export interface ReadinessInput {
  /** The last few KiB of pty output. */
  tail: string
  /** Timestamp of the last output byte. */
  lastOutputAt: number
  now: number
  /** Output must have been quiet for this long (default 500ms). */
  quietMs?: number
}

export interface Readiness {
  ready: boolean
  reason?: string
}

/** Whether the composer is idle and free of blocking modals. */
export function isReadyForInjection(input: ReadinessInput): Readiness {
  const quietMs = input.quietMs ?? 500
  if (input.now - input.lastOutputAt < quietMs) {
    return { ready: false, reason: 'codex is still producing output' }
  }
  const visible = plainText(input.tail)
  const blocked = BLOCK_MARKERS.find((marker) => visible.includes(marker))
  if (blocked !== undefined) {
    return { ready: false, reason: `codex is waiting for you (${blocked})` }
  }
  if (!visible.includes(COMPOSER_MARKER)) {
    return { ready: false, reason: 'codex composer is not visible yet' }
  }
  return { ready: true }
}

/**
 * Flatten a raw pty stream into matchable text.
 *
 * codex does not print its screens as plain lines: it draws each WORD with a
 * cursor-positioning escape (`Trust\u001b[5;9Hthis\u001b[5;14Hfolder?`), so a raw
 * `includes('Trust this folder?')` never matches and a naive ANSI strip yields
 * `Trustthisfolder?`. Replacing every escape with a space and collapsing runs
 * reconstructs the visible text closely enough for marker matching.
 */
export function plainText(value: string): string {
  const spaced = value.replace(
    // OSC (title) sequences, CSI sequences, and simple two-byte escapes.
    // eslint-disable-next-line no-control-regex -- terminal control bytes are the point
    /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g,
    ' ',
  )
  return spaced.replace(/\s+/g, ' ').trim()
}

/**
 * Did the pasted text actually land in the composer?
 *
 * This is the second half of the safety story, and it exists because codex
 * paints its composer FIRST and only later (seconds later, observed live) clears
 * the screen for a modal such as `Trust this folder?`. A readiness check alone
 * therefore cannot prevent the race — the paste is what proves it: a modal
 * swallows the paste, the composer echoes it. We only press Enter on an echo.
 *
 * `probeChars` keeps the check robust against wrapping and redraws.
 */
export function pasteLanded(tail: string, text: string, probeChars = 32): boolean {
  const firstLine = text.split('\n')[0] ?? ''
  const probe = firstLine.slice(0, Math.max(8, probeChars)).replace(/\s+/g, ' ').trim()
  if (probe === '') return false
  return plainText(tail).includes(probe)
}
