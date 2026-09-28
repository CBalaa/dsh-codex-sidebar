/**
 * `/codex-sidebar/ws?sessionId=<id>` — the terminal transport.
 *
 * Frame shape mirrors better-sidebar's terminal so the client behaves the same:
 * a non-JSON frame is raw keyboard input, JSON frames are controls
 * (`{type:'resize'|'park'|'close'}`), and server → client is raw pty output.
 *
 * Lifecycle difference from the built-in terminal: closing the tab PARKS the
 * codex instead of killing it (approved decision 2026-09-24 — the codex is
 * persistent and a re-opened tab reattaches to the same process).
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { CodexRegistry } from './registry.ts';
import type { SpawnInput } from './spawn.ts';
export interface WsDeps {
    registry: CodexRegistry;
    /** Resolve (or create) the session's spawn input. */
    prepare(sessionId: string, clientCwd?: string): Promise<{
        spawn: SpawnInput;
        cwd: string;
    }>;
    /** Whether an upgrade request passes the fence. */
    isTrusted(req: IncomingMessage): boolean;
    /** Grace window before a dropped socket kills the codex (page refresh). */
    reconnectGraceMs?: number;
    onError?(message: string): void;
}
export interface WsHandle {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    close(): void;
}
export declare function createCodexWs(deps: WsDeps): WsHandle;
