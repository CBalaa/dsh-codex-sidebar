/**
 * The codex terminal view: toolbar (status + restart/stop/clear) over an xterm.
 *
 * Transport contract mirrors better-sidebar's TerminalView: raw input frames
 * out, raw output frames in, JSON control frames for resize/park/close. No
 * custom key handler is installed, so keystrokes (including Ctrl+C and the arrow
 * keys) reach xterm's own textarea and go straight to codex — the "focused
 * window wins" requirement.
 *
 * Unmount while the tab is still open means the user switched conversations: we
 * PARK (the codex keeps running). Closing the tab detaches the same way; only the
 * toolbar's explicit stop kills the process.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { SidebarTabComponentProps } from '../better-sidebar.ts'
import { kill, markSeen, restart, stateOf, subscribe, watch, type CodexTabState } from './state.ts'
import { OutputGate } from './terminal-gate.ts'

/** Consecutive unexplained closes before we stop reconnecting on our own. */
const FAILURE_LIMIT = 3
/** Reconnect delay after a dropped socket (page refresh / host hiccup). */
const RECONNECT_MS = 2000

const STATE_LABEL: Record<CodexTabState['state'], string> = {
  none: '未启动',
  running: '运行中',
  exited: '已退出',
  error: '出错',
}

const STATE_COLOR: Record<CodexTabState['state'], string> = {
  none: '#8a8a8a',
  running: '#4ec9b0',
  exited: '#d7ba7d',
  error: '#f48771',
}

export function CodexView({ scope, visible, tab }: SidebarTabComponentProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const state = useSyncExternalStore(
    (listener) => subscribe(listener),
    () => stateOf(scope.sessionId),
  )

  useEffect(() => watch(scope.sessionId), [scope.sessionId])

  useEffect(() => {
    if (!visible) return
    void markSeen(scope.sessionId)
  }, [visible, scope.sessionId, state.unread])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      scrollback: 5000,
      allowProposedApi: true,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      // The panel can be zero-sized on the first paint.
    }

    const url = new URL('/codex-sidebar/ws', location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('sessionId', scope.sessionId)
    if (scope.cwd !== undefined) url.searchParams.set('cwd', scope.cwd)

    let socket: WebSocket | null = null
    let disposed = false
    let failures = 0

    // Nothing reaches the terminal (and the server never learns our geometry)
    // until the panel has a real size — see terminal-gate.ts for the repro.
    const gate = new OutputGate((data) => { term.write(data) })
    const announceSize = (repaint: boolean): void => {
      if (socket?.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      if (repaint) socket.send(JSON.stringify({ type: 'repaint' }))
    }

    const connect = (): void => {
      if (disposed) return
      const ws = new WebSocket(url)
      socket = ws
      ws.onopen = () => {
        failures = 0
        setError(null)
        // The first usable geometry was already reached: tell the server now.
        if (gate.ready) announceSize(true)
      }
      ws.onmessage = (event: MessageEvent) => {
        gate.push(String(event.data))
      }
      ws.onclose = (event: CloseEvent) => {
        if (disposed) return
        if (event.reason !== '') {
          failures += 1
          setError(event.reason)
          if (failures >= FAILURE_LIMIT) return
        }
        setTimeout(connect, RECONNECT_MS)
      }
    }
    connect()

    const inputSub = term.onData((data: string) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data)
    })
    const resizeSub = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }))
    })
    const refit = (): void => {
      try {
        fit.fit()
      } catch {
        // Hidden or detached panel.
      }
      // Transitioning to a usable size: flush what the server already sent and
      // ask codex to repaint at the true geometry.
      if (gate.size(term.cols, term.rows)) announceSize(true)
    }
    window.addEventListener('resize', refit)
    const observer = new ResizeObserver(refit)
    observer.observe(host)
    const settle = setTimeout(refit, 50)
    const settleLater = setTimeout(refit, 400)
    refit()

    return () => {
      disposed = true
      clearTimeout(settle)
      clearTimeout(settleLater)
      window.removeEventListener('resize', refit)
      observer.disconnect()
      inputSub.dispose()
      resizeSub.dispose()
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'park' }))
      socket?.close()
      term.dispose()
      termRef.current = null
    }
  }, [scope.sessionId])

  const act = (action: () => Promise<void>): void => {
    setBusy(true)
    void action()
      .catch((cause: unknown) => { setError((cause as Error).message) })
      .finally(() => { setBusy(false) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'ui-monospace, monospace',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
        }}
      >
        <span style={{ color: STATE_COLOR[state.state] }}>●</span>
        <span>{STATE_LABEL[state.state]}</span>
        {state.threadId !== null && <span style={{ opacity: 0.6 }}>{state.threadId.slice(0, 8)}</span>}
        {state.unread > 0 && <span style={{ color: '#d7ba7d' }}>{state.unread} 条未读</span>}
        <span style={{ flex: 1 }} />
        {state.state !== 'running' && state.bound && (
          <button disabled={busy} onClick={() => { act(async () => { await restart(scope) }) }}>重启</button>
        )}
        {state.bound && (
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm('结束这个 codex 进程？（对话历史保留在 codex 侧，重开将启动新进程）')) return
              act(async () => { await kill(scope) })
            }}
          >
            结束 codex
          </button>
        )}
        <button onClick={() => { termRef.current?.clear() }}>清屏</button>
      </div>
      {error !== null && (
        <div style={{ padding: '4px 8px', fontSize: 12, color: '#f48771', fontFamily: 'monospace' }}>
          codex 连接异常：{error}
          <button
            style={{ marginLeft: 8 }}
            onClick={() => { setError(null); location.reload() }}
          >
            重试
          </button>
        </div>
      )}
      <div ref={hostRef} data-codex-tab={tab.id} style={{ flex: 1, minHeight: 0, padding: 2 }} />
    </div>
  )
}
