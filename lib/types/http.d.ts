/**
 * The browser-facing JSON API for the sidebar tab (fenced like the WS route).
 *
 *   GET  /codex-sidebar/api/state?sessionId=   -> instance status + unread count
 *   POST /codex-sidebar/api/seen               -> clear the unread badge
 *   POST /codex-sidebar/api/restart            -> respawn an exited codex
 *   POST /codex-sidebar/api/kill               -> explicit stop (the tab's toolbar)
 *
 * Every route passes `isTrustedRequest` before doing anything: this API can kill
 * and respawn processes, so a cross-site caller must never reach it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CodexRegistry } from './registry.ts';
import type { SpawnInput } from './spawn.ts';
export interface HttpDeps {
    registry: CodexRegistry;
    isTrusted(req: IncomingMessage): boolean;
    /** Resolve the spawn input for a session (same path the WS uses). */
    prepare(sessionId: string): Promise<{
        spawn: SpawnInput;
    }>;
    onError?(message: string): void;
}
export interface HttpHandle {
    handle(req: IncomingMessage, res: ServerResponse): void;
}
export declare function createCodexHttp(deps: HttpDeps): HttpHandle;
