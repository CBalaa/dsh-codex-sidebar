/**
 * Output gate for the codex terminal.
 *
 * Why this exists (reproduced with a headless xterm): when the tab mounts right
 * after a page refresh, `fit()` can run before the sidebar panel has been laid
 * out, yielding a tiny geometry (12x3 was observed). Writing the replayed
 * transcript at that width wraps the TUI's absolute-positioned frames into
 * garbage that a later resize cannot un-wrap — the user sees an unreadable
 * "black window" until something forces a full repaint.
 *
 * So the rule is: nothing is written into the terminal, and the server is never
 * told our geometry, until the terminal has a usable size.
 */

/** Below this the panel has not been laid out yet. */
export const MIN_COLS = 30
export const MIN_ROWS = 6

/** Cap on buffered output while waiting for a usable size (bytes). */
export const BUFFER_LIMIT = 1 << 21

/** Whether a terminal geometry is real enough to render TUI output into. */
export function hasUsableSize(cols: number, rows: number): boolean {
  return cols >= MIN_COLS && rows >= MIN_ROWS
}

/** Buffers server output until the terminal reports a usable size. */
export class OutputGate {
  private open = false
  private bufferedBytes = 0
  private readonly pending: string[] = []

  constructor(private readonly write: (data: string) => void) {}

  get ready(): boolean {
    return this.open
  }

  get buffered(): number {
    return this.bufferedBytes
  }

  /**
   * Report the current geometry. Returns true on the transition to usable — the
   * caller should then tell the server the real size (and ask for a repaint).
   */
  size(cols: number, rows: number): boolean {
    if (this.open || !hasUsableSize(cols, rows)) return false
    this.open = true
    for (const chunk of this.pending.splice(0)) this.write(chunk)
    this.bufferedBytes = 0
    return true
  }

  /** Queue or write one server chunk. */
  push(data: string): void {
    if (this.open) {
      this.write(data)
      return
    }
    this.pending.push(data)
    this.bufferedBytes += data.length
    // Keep the tail (the newest frames are the ones that matter) bounded.
    while (this.bufferedBytes > BUFFER_LIMIT && this.pending.length > 1) {
      const dropped = this.pending.shift()
      this.bufferedBytes -= dropped?.length ?? 0
    }
  }
}
