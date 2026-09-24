/**
 * Client-side state for the sidebar tab: the unread badge and the toolbar's
 * status dot.
 *
 * `badge` runs on every tab-bar render, so it must read a plain module-level map
 * — no fetching inside it. A single 3-second poll (skipped while the document is
 * hidden, and paused entirely when nobody is subscribed) keeps that map fresh.
 */
import type { SidebarSessionScope } from '../better-sidebar.ts'

export interface CodexTabState {
  bound: boolean
  state: 'none' | 'running' | 'exited' | 'error'
  instanceId: string | null
  threadId: string | null
  cwd: string | null
  unread: number
  exitCode: number | null
}

const EMPTY: CodexTabState = {
  bound: false,
  state: 'none',
  instanceId: null,
  threadId: null,
  cwd: null,
  unread: 0,
  exitCode: null,
}

const states = new Map<string, CodexTabState>()
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setInterval>>()

function publish(sessionId: string, next: CodexTabState): void {
  const previous = states.get(sessionId)
  if (
    previous !== undefined &&
    previous.bound === next.bound &&
    previous.state === next.state &&
    previous.unread === next.unread &&
    previous.threadId === next.threadId &&
    previous.exitCode === next.exitCode
  ) {
    return
  }
  states.set(sessionId, next)
  for (const listener of listeners) listener()
}

/** The unread count for a session — cheap, synchronous, never fetches. */
export function unreadOf(sessionId: string): number {
  return states.get(sessionId)?.unread ?? 0
}

/** The current known state for a session. */
export function stateOf(sessionId: string): CodexTabState {
  return states.get(sessionId) ?? EMPTY
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function refresh(sessionId: string): Promise<void> {
  try {
    const response = await fetch(`/codex-sidebar/api/state?sessionId=${encodeURIComponent(sessionId)}`)
    if (!response.ok) return
    publish(sessionId, (await response.json()) as CodexTabState)
  } catch {
    // A transient failure keeps the previous state; the next tick retries.
  }
}

/** Start (idempotently) polling one session's state. Returns a stop function. */
export function watch(sessionId: string): () => void {
  if (!timers.has(sessionId)) {
    void refresh(sessionId)
    timers.set(
      sessionId,
      setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        void refresh(sessionId)
      }, 3000),
    )
  }
  return () => {
    const timer = timers.get(sessionId)
    if (timer !== undefined) {
      clearInterval(timer)
      timers.delete(sessionId)
    }
  }
}

/** Tell the host the user has looked at the tab. */
export async function markSeen(sessionId: string): Promise<void> {
  const current = states.get(sessionId)
  if (current !== undefined && current.unread > 0) publish(sessionId, { ...current, unread: 0 })
  try {
    await fetch('/codex-sidebar/api/seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  } catch {
    // The badge resets on the next successful poll anyway.
  }
}

/** Toolbar action: restart an exited codex. */
export async function restart(scope: SidebarSessionScope): Promise<void> {
  await fetch('/codex-sidebar/api/restart', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: scope.sessionId }),
  })
  await refresh(scope.sessionId)
}

/** Toolbar action: stop the codex process for good. */
export async function kill(scope: SidebarSessionScope): Promise<void> {
  await fetch('/codex-sidebar/api/kill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: scope.sessionId }),
  })
  await refresh(scope.sessionId)
}
