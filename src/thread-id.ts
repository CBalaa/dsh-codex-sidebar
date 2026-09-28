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

/** One parsed `session_meta` line of a rollout file. */
export interface RolloutMeta {
  id?: string
  cwd?: string
  /** 'cli' for a top-level TUI session; an object for subagent/fork sessions. */
  source?: unknown
}

/** Parse the `session_meta` line (the first line) of a rollout file. */
export function parseRolloutMeta(firstLine: string): RolloutMeta | undefined {
  try {
    const parsed = JSON.parse(firstLine) as { type?: string; payload?: RolloutMeta }
    if (parsed.type !== 'session_meta' || parsed.payload === undefined) return undefined
    return parsed.payload
  } catch {
    return undefined
  }
}

/** The default `$CODEX_HOME/sessions` directory. */
export async function defaultSessionsDir(): Promise<string> {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
}

/**
 * Fallback discovery of THIS instance's thread id.
 *
 * `codex queue --thread <id>` is the clean delivery path, but the id is only
 * printed in the TUI status line — which a narrow sidebar truncates. So we also
 * look for the rollout codex wrote for this session.
 *
 * Safety matters more than availability here: queueing into the WRONG thread
 * would inject a message into somebody else's codex session. Candidates are
 * therefore filtered to rollout files written after this instance spawned whose
 * `session_meta` names the same cwd and a top-level `cli` source, and we only
 * answer when the match is unique (or the newest leads the runner-up by a clear
 * margin). Anything ambiguous returns undefined and the caller falls back to the
 * readiness-gated pty path.
 */
export async function discoverThreadIdFromRollouts(input: {
  sessionsDir: string
  spawnedAt: number
  /** The instance's working directory — the disambiguator that matters. */
  cwd?: string
  /** Slack for filesystem timestamp granularity. */
  slackMs?: number
  /** Minimum lead over the runner-up to accept an ambiguous set (default 2s). */
  minLeadMs?: number
}): Promise<string | undefined> {
  const { readdir, stat, open } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const slack = input.slackMs ?? 5_000
  const minLead = input.minLeadMs ?? 2_000
  const candidates: { id: string; mtimeMs: number }[] = []

  /** Only the first line matters: read a bounded head, never the whole file. */
  const readMeta = async (file: string): Promise<RolloutMeta | undefined> => {
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(16 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? ''
      return parseRolloutMeta(firstLine)
    } catch {
      return undefined
    } finally {
      await handle.close()
    }
  }

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
      if (info.mtimeMs + slack < input.spawnedAt) continue
      const nameId = threadIdFromRolloutName(entry)
      if (nameId === undefined) continue
      const meta = await readMeta(full)
      if (meta === undefined) continue
      // The id must agree between the file name and the metadata.
      if (typeof meta.id !== 'string' || meta.id.toLowerCase() !== nameId) continue
      if (input.cwd !== undefined && meta.cwd !== input.cwd) continue
      // A subagent/fork session is never our codex.
      if (meta.source !== 'cli') continue
      candidates.push({ id: nameId, mtimeMs: info.mtimeMs })
    }
  }
  await walk(input.sessionsDir, 0)

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const newest = candidates[0]
  if (newest === undefined) return undefined
  const runnerUp = candidates[1]
  if (runnerUp !== undefined && newest.mtimeMs - runnerUp.mtimeMs < minLead) return undefined
  return newest.id
}
