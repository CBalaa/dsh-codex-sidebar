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
export declare const BLOCK_MARKERS: readonly ["Trust this folder?", "Do you trust the contents of this directory", "Press enter to continue", "esc to cancel", "Allow command?"];
/** The composer prompt codex paints when it is ready for input. */
export declare const COMPOSER_MARKER = "\u203A";
export interface ReadinessInput {
    /** The last few KiB of pty output. */
    tail: string;
    /** Timestamp of the last output byte. */
    lastOutputAt: number;
    now: number;
    /** Output must have been quiet for this long (default 500ms). */
    quietMs?: number;
}
export interface Readiness {
    ready: boolean;
    reason?: string;
}
/** Whether the composer is idle and free of blocking modals. */
export declare function isReadyForInjection(input: ReadinessInput): Readiness;
/**
 * Flatten a raw pty stream into matchable text.
 *
 * codex does not print its screens as plain lines: it draws each WORD with a
 * cursor-positioning escape (`Trust\u001b[5;9Hthis\u001b[5;14Hfolder?`), so a raw
 * `includes('Trust this folder?')` never matches and a naive ANSI strip yields
 * `Trustthisfolder?`. Replacing every escape with a space and collapsing runs
 * reconstructs the visible text closely enough for marker matching.
 */
export declare function plainText(value: string): string;
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
export declare function pasteLanded(tail: string, text: string, probeChars?: number): boolean;
