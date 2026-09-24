/**
 * node-pty loading, kept out of the module graph until first use so a machine
 * without the native module still activates the plugin (the tab then reports a
 * readable spawn error instead of the whole host failing).
 */
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'

export interface NodePtyModule {
  spawn(file: string, args: string[] | string, options: Record<string, unknown>): IPty
}

let cached: NodePtyModule | null = null

/**
 * Restore the executable bit pnpm strips from node-pty's spawn-helper (the
 * macOS helper that forks and sets up the pty). Without it every spawn fails
 * with `posix_spawnp failed`. Same fix better-sidebar applies at activation
 * (src/pty-manager.ts:27-44), kept here because a link-installed deployment
 * never runs node-pty's own postinstall.
 */
export function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('node-pty')
    const root = dirname(dirname(entry))
    for (const helper of [
      join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      join(root, 'build', 'Release', 'spawn-helper'),
    ]) {
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  } catch {
    // Resolution failure surfaces as a spawn error with its own message.
  }
}

/** Load node-pty once; throws a readable error when the native module is absent. */
export async function loadNodePty(): Promise<NodePtyModule> {
  if (cached !== null) return cached
  ensureSpawnHelper()
  try {
    const mod = (await import('node-pty')) as unknown as NodePtyModule
    cached = mod
    return mod
  } catch (error) {
    throw new Error(
      `node-pty is unavailable (${(error as Error).message}). Run \`pnpm install\` (or \`pnpm rebuild node-pty\`) in the dsh-codex-sidebar package.`,
    )
  }
}
