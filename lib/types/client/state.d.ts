/**
 * Client-side state for the sidebar tab: the unread badge and the toolbar's
 * status dot.
 *
 * `badge` runs on every tab-bar render, so it must read a plain module-level map
 * — no fetching inside it. A single 3-second poll (skipped while the document is
 * hidden, and paused entirely when nobody is subscribed) keeps that map fresh.
 */
import type { SidebarSessionScope } from '../better-sidebar.ts';
export interface CodexTabState {
    bound: boolean;
    state: 'none' | 'running' | 'exited' | 'error';
    instanceId: string | null;
    threadId: string | null;
    cwd: string | null;
    unread: number;
    exitCode: number | null;
}
/** The unread count for a session — cheap, synchronous, never fetches. */
export declare function unreadOf(sessionId: string): number;
/** The current known state for a session. */
export declare function stateOf(sessionId: string): CodexTabState;
export declare function subscribe(listener: () => void): () => void;
/** Start (idempotently) polling one session's state. Returns a stop function. */
export declare function watch(sessionId: string): () => void;
/** Tell the host the user has looked at the tab. */
export declare function markSeen(sessionId: string): Promise<void>;
/** Toolbar action: restart an exited codex. */
export declare function restart(scope: SidebarSessionScope): Promise<void>;
/** Toolbar action: stop the codex process for good. */
export declare function kill(scope: SidebarSessionScope): Promise<void>;
