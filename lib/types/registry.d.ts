import type { IPty } from 'node-pty';
import { type SpawnInput, type SpawnPlan } from './spawn.ts';
/** Bytes kept for transcript replay (same bound as better-sidebar's terminal). */
export declare const TRANSCRIPT_LIMIT: number;
/** Bytes kept for readiness/marker scanning. */
export declare const TAIL_LIMIT = 4096;
/** Messages kept per inbox. */
export declare const INBOX_LIMIT = 200;
export type CodexState = 'running' | 'exited' | 'error';
export interface CodexMessage {
    id: string;
    from: 'dsh' | 'codex';
    text: string;
    at: number;
}
export interface CodexInstance {
    id: string;
    sessionId: string;
    cwd: string;
    spawn: SpawnInput;
    pty: IPty;
    transcript: string;
    tail: string;
    state: CodexState;
    exitCode?: number;
    error?: string;
    /** codex's own session UUID, once discovered from the TUI output. */
    threadId?: string;
    /** codex → DSH messages delivered since the user last looked at the tab. */
    unread: number;
    /** DSH → codex messages (readable by the MCP shim). */
    inboxForCodex: CodexMessage[];
    /** codex → DSH messages (readable by the codex_read tool). */
    inboxForDsh: CodexMessage[];
    parked: boolean;
    closeTimer?: NodeJS.Timeout;
    spawnAt: number;
    lastOutputAt: number;
}
export interface RegistryOptions {
    /** Build the process plan (tests inject a fake). */
    plan(input: SpawnInput): SpawnPlan;
    /** Spawn a pty (tests inject a fake IPty). */
    spawnPty(plan: SpawnPlan, size: {
        cols: number;
        rows: number;
    }): Promise<IPty>;
    /** Called for every output chunk, after the transcript/tail were updated. */
    onData?(instance: CodexInstance, data: string): void;
    now?(): number;
}
export declare class CodexRegistry {
    private readonly options;
    private readonly bySession;
    private readonly byId;
    constructor(options: RegistryOptions);
    list(): CodexInstance[];
    get(sessionId: string): CodexInstance | undefined;
    getById(id: string): CodexInstance | undefined;
    /**
     * Get-or-create the session's codex. A live instance is reused (and its
     * pending close cancelled) so reconnects and re-opens land on the same
     * process; an exited one is replaced.
     */
    open(spawn: SpawnInput, size: {
        cols: number;
        rows: number;
    }): Promise<CodexInstance>;
    private create;
    /** Record a codex → DSH message (bumps the unread badge). */
    recordToDsh(instance: CodexInstance, text: string): CodexMessage;
    /** Record a DSH → codex message (the MCP shim reads this inbox). */
    recordToCodex(instance: CodexInstance, text: string): CodexMessage;
    markSeen(sessionId: string): void;
    park(id: string): void;
    /** Schedule destruction after `delayMs` (0 = now); `open()` cancels it. */
    scheduleClose(id: string, delayMs: number): void;
    cancelClose(id: string): void;
    dispose(id: string): void;
    disposeAll(): void;
}
/** Production spawn: node-pty with an xterm-256color terminal. */
export declare function spawnCodexPty(plan: SpawnPlan, size: {
    cols: number;
    rows: number;
}): Promise<IPty>;
/** The production registry options. */
export declare function productionOptions(): RegistryOptions;
