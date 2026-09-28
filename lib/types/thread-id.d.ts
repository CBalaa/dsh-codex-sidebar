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
/** The last UUIDv7 in the accumulated transcript, lowercased. */
export declare function threadIdFromTranscript(transcript: string): string | undefined;
/** The UUID embedded in a rollout file name. */
export declare function threadIdFromRolloutName(name: string): string | undefined;
/** One parsed `session_meta` line of a rollout file. */
export interface RolloutMeta {
    id?: string;
    cwd?: string;
    /** 'cli' for a top-level TUI session; an object for subagent/fork sessions. */
    source?: unknown;
}
/** Parse the `session_meta` line (the first line) of a rollout file. */
export declare function parseRolloutMeta(firstLine: string): RolloutMeta | undefined;
/** The default `$CODEX_HOME/sessions` directory. */
export declare function defaultSessionsDir(): Promise<string>;
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
export declare function discoverThreadIdFromRollouts(input: {
    sessionsDir: string;
    spawnedAt: number;
    /** The instance's working directory — the disambiguator that matters. */
    cwd?: string;
    /** Slack for filesystem timestamp granularity. */
    slackMs?: number;
    /** Minimum lead over the runner-up to accept an ambiguous set (default 2s). */
    minLeadMs?: number;
}): Promise<string | undefined>;
