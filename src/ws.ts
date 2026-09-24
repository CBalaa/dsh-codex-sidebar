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
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { CodexInstance, CodexRegistry } from './registry.ts'
import type { SpawnInput } from './spawn.ts'

export interface WsDeps {
  registry: CodexRegistry
  /** Resolve (or create) the session's spawn input. */
  prepare(sessionId: string, clientCwd?: string): Promise<{ spawn: SpawnInput; cwd: string }>
  /** Whether an upgrade request passes the fence. */
  isTrusted(req: IncomingMessage): boolean
  /** Grace window before a dropped socket kills the codex (page refresh). */
  reconnectGraceMs?: number
  onError?(message: string): void
}

export interface WsHandle {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  close(): void
}

export function createCodexWs(deps: WsDeps): WsHandle {
  const wss = new WebSocketServer({ noServer: true })
  const grace = deps.reconnectGraceMs ?? 30_000

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    void attach(ws, req)
  })

  async function attach(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null || sessionId === '') {
      ws.close(1008, 'sessionId is required')
      return
    }
    let instance: CodexInstance
    try {
      const prepared = await deps.prepare(sessionId, url.searchParams.get('cwd') ?? undefined)
      instance = await deps.registry.open(prepared.spawn, { cols: 80, rows: 24 })
    } catch (error) {
      const reason = `codex-spawn-failed:${(error as Error).message}`.slice(0, 120)
      deps.onError?.(reason)
      ws.close(1011, reason)
      return
    }
    deps.registry.cancelClose(instance.id)
    instance.parked = false
    if (instance.transcript !== '') ws.send(instance.transcript)

    const onData = (data: string): void => {
      if (ws.readyState === ws.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(data)
    }
    const onExit = ({ exitCode }: { exitCode: number }): void => {
      onData(`\r\n[codex exited with code ${String(exitCode)}]\r\n`)
    }
    const dataSub = instance.pty.onData(onData)
    const exitSub = instance.pty.onExit(onExit)

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const text = raw.toString()
      if (!text.startsWith('{')) {
        instance.pty.write(text)
        return
      }
      try {
        const frame = JSON.parse(text) as { type?: string; cols?: number; rows?: number }
        if (frame.type === 'resize' && typeof frame.cols === 'number' && typeof frame.rows === 'number') {
          try {
            instance.pty.resize(Math.max(2, Math.floor(frame.cols)), Math.max(2, Math.floor(frame.rows)))
          } catch {
            // The process exited between the frame and the resize.
          }
          return
        }
        if (frame.type === 'park' || frame.type === 'close') {
          // Detach: the view is gone, the codex keeps running (spec §2.2).
          deps.registry.park(instance.id)
          return
        }
      } catch {
        instance.pty.write(text)
      }
    })

    ws.on('close', () => {
      dataSub.dispose()
      exitSub.dispose()
      if (!instance.parked) deps.registry.scheduleClose(instance.id, grace)
    })
  }

  return {
    handleUpgrade(req, socket, head) {
      if (!deps.isTrusted(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    },
    close() {
      wss.close()
    },
  }
}
