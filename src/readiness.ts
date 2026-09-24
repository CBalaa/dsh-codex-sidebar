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
  const blocked = BLOCK_MARKERS.find((marker) => input.tail.includes(marker))
  if (blocked !== undefined) {
    return { ready: false, reason: `codex is waiting for you (${blocked})` }
  }
  if (!input.tail.includes(COMPOSER_MARKER)) {
    return { ready: false, reason: 'codex composer is not visible yet' }
  }
  return { ready: true }
}
