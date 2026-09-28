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
import { isReadyForInjection, pasteLanded, plainText } from '../src/readiness.ts'
import { deliverToCodex } from '../src/deliver.ts'

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

  it('pastes into the live TUI and never submits while a modal owns the screen', async () => {
    const registry = new CodexRegistry(productionOptions())
    const spawn: SpawnInput = {
      shimPath: shim,
      nodePath: process.execPath,
      sessionId: 'smoke-inject',
      instanceId: randomUUID(),
      cwd: join(import.meta.dirname, '..'),
      loopbackUrl: 'http://127.0.0.1:1',
      loopbackToken: 'smoke-token',
      codexPath: resolveCodex(),
    }
    const instance = await registry.open(spawn, { cols: 100, rows: 30 })
    const marker = 'DSH_SMOKE_INJECTION_TOKEN'

    // Watch the real TUI settle: codex paints its composer first and may clear
    // the screen for the folder-trust modal seconds later, which is exactly the
    // race `deliverToCodex` defends against.
    const deadline = Date.now() + 25_000
    let sawModal = false
    while (Date.now() < deadline) {
      if (plainText(instance.tail).includes('Trust this folder?')) { sawModal = true; break }
      const ready = isReadyForInjection({ tail: instance.tail, lastOutputAt: instance.lastOutputAt, now: Date.now() })
      if (ready.ready && Date.now() > deadline - 15_000) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    // eslint-disable-next-line no-console -- smoke diagnostics are the point
    console.log(`--- modal up: ${String(sawModal)} ---\n`, instance.tail.slice(-400))

    if (process.env.DSH_CODEX_SMOKE_SUBMIT === '1') {
      // Opt-in: this path presses Enter and therefore starts a real codex turn.
      const result = await deliverToCodex(
        { run: async () => ({ code: 1, stdout: '', stderr: 'forced pty path' }), now: Date.now },
        instance,
        marker,
        resolveCodex(),
      )
      expect(result.via).toBe('pty')
      expect(instance.transcript).toContain(marker)
      registry.dispose(instance.id)
      return
    }

    // Default, free path: paste only. A modal swallows it, the composer echoes
    // it — either way nothing is submitted, and the modal must survive intact.
    instance.pty.write(`\u001b[200~${marker}\u001b[201~`)
    const echoDeadline = Date.now() + 4_000
    while (Date.now() < echoDeadline && !pasteLanded(instance.tail, marker)) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    const landed = pasteLanded(instance.tail, marker)
    // eslint-disable-next-line no-console -- smoke diagnostics are the point
    console.log(`--- paste landed: ${String(landed)} ---\n`, instance.tail.slice(-300))
    // The invariant: the paste either reached the composer (echoed back) or was
    // swallowed by something that is still on screen waiting for the human.
    expect(landed || sawModal || !isReadyForInjection({
      tail: instance.tail,
      lastOutputAt: instance.lastOutputAt,
      now: Date.now(),
    }).ready).toBe(true)
    registry.dispose(instance.id)
  }, 60_000)
})
