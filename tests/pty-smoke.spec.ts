/**
 * Live PTY smoke test — skipped unless DSH_CODEX_SMOKE=1.
 *
 * It spawns a REAL codex process through the same registry/spawn path the
 * plugin uses (identity injection + MCP registration + xterm-256color), asserts
 * that the TUI actually paints, that keystrokes reach it, and that killing the
 * instance releases the process. This is the only automated proof that the
 * spawn contract works against the installed codex build.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexRegistry, productionOptions } from '../src/registry.ts'
import type { SpawnInput } from '../src/spawn.ts'
import { resolveCodex } from '../src/index.ts'

const enabled = process.env.DSH_CODEX_SMOKE === '1'
const shim = join(import.meta.dirname, '..', 'lib', 'codex-mcp.js')

describe.skipIf(!enabled)('live codex pty', () => {
  it('paints the codex TUI, accepts input, and dies on dispose', async () => {
    const registry = new CodexRegistry(productionOptions())
    const instanceId = randomUUID()
    const spawn: SpawnInput = {
      shimPath: shim,
      nodePath: process.execPath,
      sessionId: 'smoke-session',
      instanceId,
      cwd: join(import.meta.dirname, '..'),
      loopbackUrl: 'http://127.0.0.1:1',
      loopbackToken: 'smoke-token',
      codexPath: resolveCodex(),
    }
    const instance = await registry.open(spawn, { cols: 100, rows: 30 })
    expect(existsSync(shim)).toBe(true)
    expect(instance.state).toBe('running')

    // Wait for the TUI to paint something (banner, trust prompt or composer).
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && instance.transcript.length < 200) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    // eslint-disable-next-line no-console -- smoke diagnostics are the point
    console.log('--- transcript head ---\n', instance.transcript.slice(0, 1200))
    expect(instance.transcript.length).toBeGreaterThan(0)
    expect(instance.transcript).toMatch(/codex/i)

    // Keystrokes must reach the process (echoed or reflected in a redraw).
    const before = instance.transcript.length
    instance.pty.write('x')
    const echoDeadline = Date.now() + 5_000
    while (Date.now() < echoDeadline && instance.transcript.length === before) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(instance.transcript.length).toBeGreaterThan(before)

    registry.dispose(instance.id)
    expect(registry.list()).toHaveLength(0)
  }, 60_000)
})
