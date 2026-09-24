/**
 * Discovery of codex's own thread id, which `codex queue --thread <id>` needs.
 *
 * Two strategies, both pure parsers here so they are unit-testable:
 * 1. the UUIDv7 codex prints in its TUI status line (scanned from the bounded
 *    transcript — the status line is redrawn, so the LAST match wins);
 * 2. the rollout file name codex writes under $CODEX_HOME/sessions once a turn
 *    has happened (`rollout-<timestamp>-<uuid>.jsonl`).
 *
 * When neither yields an id the delivery path falls back to pty injection.
 */

/** UUIDv7 as printed by codex (version nibble 7, RFC 4122 variant). */
const UUID_V7 = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi

/** The last UUIDv7 in the accumulated transcript, lowercased. */
export function threadIdFromTranscript(transcript: string): string | undefined {
  const matches = transcript.match(UUID_V7)
  if (matches === null || matches.length === 0) return undefined
  return matches[matches.length - 1]?.toLowerCase()
}

/** The UUID embedded in a rollout file name. */
export function threadIdFromRolloutName(name: string): string | undefined {
  const match = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
    name,
  )
  return match?.[1]?.toLowerCase()
}

/**
 * Fallback discovery: the newest rollout file written after this instance
 * spawned. codex only writes a rollout once a turn starts, so this succeeds
 * exactly when `codex queue` becomes usable.
 */
export async function discoverThreadIdFromRollouts(input: {
  sessionsDir: string
  spawnedAt: number
}): Promise<string | undefined> {
  const { readdir, stat } = await import('node:fs/promises')
  const { join } = await import('node:path')
  let newest: { id: string; mtimeMs: number } | undefined
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      const info = await stat(full).catch(() => undefined)
      if (info === undefined) continue
      if (info.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (info.mtimeMs < input.spawnedAt) continue
      const id = threadIdFromRolloutName(entry)
      if (id === undefined) continue
      if (newest === undefined || info.mtimeMs > newest.mtimeMs) newest = { id, mtimeMs: info.mtimeMs }
    }
  }
  await walk(input.sessionsDir, 0)
  return newest?.id
}
