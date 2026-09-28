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
export declare const MIN_COLS = 30;
export declare const MIN_ROWS = 6;
/** Cap on buffered output while waiting for a usable size (bytes). */
export declare const BUFFER_LIMIT: number;
/** Whether a terminal geometry is real enough to render TUI output into. */
export declare function hasUsableSize(cols: number, rows: number): boolean;
/** Buffers server output until the terminal reports a usable size. */
export declare class OutputGate {
    private readonly write;
    private open;
    private bufferedBytes;
    private readonly pending;
    constructor(write: (data: string) => void);
    get ready(): boolean;
    get buffered(): number;
    /**
     * Report the current geometry. Returns true on the transition to usable — the
     * caller should then tell the server the real size (and ask for a repaint).
     */
    size(cols: number, rows: number): boolean;
    /** Queue or write one server chunk. */
    push(data: string): void;
}
