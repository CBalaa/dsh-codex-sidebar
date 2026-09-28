import type { CodexInstance } from './registry.ts';
export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface DeliverToCodexDeps {
    run(command: string, args: string[]): Promise<RunResult>;
    now(): number;
    /** How long to wait for the composer before giving up (default 20s). */
    waitMs?: number;
    quietMs?: number;
    /** How long to wait for the composer to echo the paste (default 2s). */
    confirmMs?: number;
    sleep?(ms: number): Promise<void>;
}
export interface DeliverToCodexResult {
    via: 'queue' | 'pty';
    detail?: string;
}
/** Deliver one message into the codex TUI. Throws with a readable reason. */
export declare function deliverToCodex(deps: DeliverToCodexDeps, instance: CodexInstance, text: string, codexPath: string): Promise<DeliverToCodexResult>;
/** Production runner for `codex queue`. */
export declare function runCodex(command: string, args: string[]): Promise<RunResult>;
