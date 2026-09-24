/**
 * codex argv/env assembly. Pure (no I/O, no process state) so the exact
 * injection contract is unit-testable.
 *
 * What is injected, and what deliberately is NOT:
 * - `-c developer_instructions=...` carries our identity text; when the user's
 *   own config.toml sets developer_instructions we APPEND theirs instead of
 *   clobbering it.
 * - `-c mcp_servers.dsh.*` registers the bridge MCP server for this instance
 *   only (no config.toml write, no CODEX_HOME override).
 * - approval_policy / sandbox_mode are NOT touched: the sidebar codex behaves
 *   exactly like the user's terminal codex (approved decision 2026-09-24).
 */
import { identityText } from './identity.ts'

export interface SpawnInput {
  /** Absolute path to this plugin's built MCP shim (lib/codex-mcp.js). */
  shimPath: string
  /** Node executable that runs the shim (the DSH host's own node). */
  nodePath: string
  sessionId: string
  instanceId: string
  cwd: string
  loopbackUrl: string
  loopbackToken: string
  /** codex executable, resolved from PATH by the caller. */
  codexPath: string
  /** The user's own developer_instructions, when their config.toml sets one. */
  userDeveloperInstructions?: string
}

export interface SpawnPlan {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

/** Render a flat string map as a TOML inline table (codex parses `-c` values as TOML). */
function tomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  return `{${entries.join(', ')}}`
}

/** Build the codex argv/env for one instance. */
export function buildSpawnPlan(input: SpawnInput): SpawnPlan {
  const instructions = [identityText({ sessionId: input.sessionId, cwd: input.cwd })]
  if (input.userDeveloperInstructions !== undefined && input.userDeveloperInstructions !== '') {
    instructions.push(input.userDeveloperInstructions)
  }
  const args = [
    '-c',
    `developer_instructions=${JSON.stringify(instructions.join('\n\n'))}`,
    '-c',
    `mcp_servers.dsh.command=${JSON.stringify(input.nodePath)}`,
    '-c',
    `mcp_servers.dsh.args=${JSON.stringify([input.shimPath])}`,
    '-c',
    // A JSON object string is NOT accepted here: codex parses the value as TOML
    // and rejects it with `invalid type: string ..., expected a map`.
    `mcp_servers.dsh.env=${tomlInlineTable({
      DSH_CODEX_URL: input.loopbackUrl,
      DSH_CODEX_TOKEN: input.loopbackToken,
      DSH_CODEX_INSTANCE: input.instanceId,
      DSH_CODEX_SESSION: input.sessionId,
    })}`,
  ]
  return {
    file: input.codexPath,
    args,
    // codex 0.156 refuses to start its TUI when TERM=dumb; the pty name alone is
    // not enough because node-pty inherits the parent environment.
    env: { ...process.env, TERM: 'xterm-256color', DSH_CODEX_INSTANCE: input.instanceId },
    cwd: input.cwd,
  }
}
