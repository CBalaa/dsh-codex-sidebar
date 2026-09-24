/**
 * The codex terminal view.
 *
 * Mirrors better-sidebar's TerminalView transport contract: raw input frames
 * out, raw output frames in, JSON control frames for resize/park/close. No
 * custom key handler is installed, so keystrokes (including Ctrl+C and the
 * arrow keys) reach xterm's own textarea and go straight to codex — the
 * "focused window wins" requirement.
 *
 * Unmount while the tab is still open means the user switched conversations:
 * we PARK (the codex keeps running). Closing the tab detaches the same way; only
 * the toolbar's explicit stop kills the process.
 */
import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { SidebarTabComponentProps } from '../better-sidebar.ts'

/** Consecutive unexplained closes before we stop reconnecting on our own. */
const FAILURE_LIMIT = 3
/** Reconnect delay after a dropped socket (page refresh / host hiccup). */
const RECONNECT_MS = 2000

export function CodexView({ scope, visible, tab }: SidebarTabComponentProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      scrollback: 5000,
      allowProposedApi: true,
    })
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

    const connect = (): void => {
      if (disposed) return
      const ws = new WebSocket(url)
      socket = ws
      ws.onopen = () => {
        failures = 0
        setError(null)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
      ws.onmessage = (event: MessageEvent) => {
        term.write(String(event.data))
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
    }
    window.addEventListener('resize', refit)
    const observer = new ResizeObserver(refit)
    observer.observe(host)
    // The tab may mount before its panel has its final size.
    const settle = setTimeout(refit, 50)

    return () => {
      disposed = true
      clearTimeout(settle)
      window.removeEventListener('resize', refit)
      observer.disconnect()
      inputSub.dispose()
      resizeSub.dispose()
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'park' }))
      socket?.close()
      term.dispose()
    }
  }, [scope.sessionId])

  useEffect(() => {
    if (!visible) return
    void fetch('/codex-sidebar/api/seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: scope.sessionId }),
    }).catch(() => undefined)
  }, [visible, scope.sessionId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
