/**
 * DSH → codex delivery (spec §4.6).
 *
 * 1. threadId known → `codex queue --thread <id> --message <text>`: the clean
 *    path, proven against codex 0.156.1 to inject into a running TUI without
 *    touching the keyboard (it needs an existing rollout, so it fails before the
 *    first turn — that failure is expected and falls through).
 * 2. otherwise → bracketed paste into the pty, gated by `isReadyForInjection`
 *    so a trust/approval modal can never receive our Enter.
 * 3. both unavailable → the caller gets the reason; nothing is silently dropped.
 */
import { spawn } from 'node:child_process'
import type { CodexInstance } from './registry.ts'
import { BLOCK_MARKERS, isReadyForInjection, pasteLanded } from './readiness.ts'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface DeliverToCodexDeps {
  run(command: string, args: string[]): Promise<RunResult>
  now(): number
  /** How long to wait for the composer before giving up (default 20s). */
  waitMs?: number
  quietMs?: number
  /** How long to wait for the composer to echo the paste (default 2s). */
  confirmMs?: number
  sleep?(ms: number): Promise<void>
}

export interface DeliverToCodexResult {
  via: 'queue' | 'pty'
  detail?: string
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Deliver one message into the codex TUI. Throws with a readable reason. */
export async function deliverToCodex(
  deps: DeliverToCodexDeps,
  instance: CodexInstance,
  text: string,
  codexPath: string,
): Promise<DeliverToCodexResult> {
  const sleep = deps.sleep ?? defaultSleep
  const failures: string[] = []

  if (instance.threadId !== undefined) {
    const result = await deps.run(codexPath, ['queue', '--thread', instance.threadId, '--message', text])
    if (result.code === 0) return { via: 'queue', detail: result.stdout.trim() }
    failures.push(`codex queue failed (exit ${String(result.code)}): ${(result.stderr || result.stdout).trim()}`)
  } else {
    failures.push('no codex thread id yet (queue needs an existing rollout)')
  }

  if (instance.state !== 'running') {
    throw new Error(`codex is not running (${instance.state})`)
  }

  const deadline = deps.now() + (deps.waitMs ?? 20_000)
  let reason = 'codex is not ready'
  // The iteration cap is insurance against a caller whose clock does not
  // advance (a test double): production uses Date.now, so it never trips.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const gate = isReadyForInjection({
      tail: instance.tail,
      lastOutputAt: instance.lastOutputAt,
      now: deps.now(),
      ...(deps.quietMs === undefined ? {} : { quietMs: deps.quietMs }),
    })
    if (gate.ready) break
    reason = gate.reason ?? reason
    if (deps.now() >= deadline) {
      failures.push(reason)
      throw new Error(`could not deliver to codex: ${failures.join('; ')}`)
    }
    await sleep(250)
  }

  instance.pty.write(`\u001b[200~${text}\u001b[201~`)

  // Enter is ONLY sent once the composer echoed the paste back: codex paints its
  // composer before a late modal (folder trust, approval) clears the screen, and
  // a modal swallows the paste. Submitting blindly could answer that modal.
  const confirmDeadline = deps.now() + (deps.confirmMs ?? 2_000)
  for (;;) {
    if (pasteLanded(instance.tail, text)) break
    if (deps.now() >= confirmDeadline) {
      const blocked = BLOCK_MARKERS.find((marker) => instance.tail.includes(marker))
      failures.push(
        blocked === undefined
          ? 'codex did not echo the pasted text (a modal or full-screen view may be open)'
          : `codex is waiting for you (${blocked}); nothing was submitted`,
      )
      throw new Error(`could not deliver to codex: ${failures.join('; ')}`)
    }
    await sleep(150)
  }

  await sleep(150)
  instance.pty.write('\r')
  return { via: 'pty', detail: failures.join('; ') }
}

/** Production runner for `codex queue`. */
export function runCodex(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error: Error) => {
      resolve({ code: -1, stdout, stderr: error.message })
    })
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
