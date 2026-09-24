import { describe, expect, it } from 'vitest'
import { buildSpawnPlan, type SpawnInput } from '../src/spawn.ts'
import { identityText } from '../src/identity.ts'

function input(overrides: Partial<SpawnInput> = {}): SpawnInput {
  return {
    shimPath: '/plugin/lib/codex-mcp.js',
    nodePath: '/usr/bin/node',
    sessionId: 'session-1',
    instanceId: 'instance-1',
    cwd: '/work/repo',
    loopbackUrl: 'http://127.0.0.1:41234',
    loopbackToken: 'token-1',
    codexPath: '/usr/bin/codex',
    ...overrides,
  }
}

/** The `-c` value following a given key (codex parses `key=value` per flag). */
function configValue(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] !== '-c') continue
    const flag = args[i + 1] ?? ''
    if (flag.startsWith(`${key}=`)) return flag.slice(key.length + 1)
  }
  return undefined
}

describe('buildSpawnPlan', () => {
  it('runs the codex binary in the session cwd', () => {
    const plan = buildSpawnPlan(input())
    expect(plan.file).toBe('/usr/bin/codex')
    expect(plan.cwd).toBe('/work/repo')
  })

  it('injects the sidebar-codex identity through developer_instructions', () => {
    const plan = buildSpawnPlan(input())
    const raw = configValue(plan.args, 'developer_instructions')
    expect(raw).toBeDefined()
    const value = JSON.parse(raw ?? '""') as string
    expect(value).toBe(identityText({ sessionId: 'session-1', cwd: '/work/repo' }))
    expect(value).toContain('sidebar-codex')
    expect(value).toContain('mcp__dsh__send_message')
  })

  it('appends the user developer_instructions instead of clobbering them', () => {
    const plan = buildSpawnPlan(input({ userDeveloperInstructions: 'USER_RULES' }))
    const value = JSON.parse(configValue(plan.args, 'developer_instructions') ?? '""') as string
    expect(value.endsWith('USER_RULES')).toBe(true)
    expect(value.indexOf('sidebar-codex')).toBeLessThan(value.indexOf('USER_RULES'))
  })

  it('registers the bridge MCP server for this instance only', () => {
    const plan = buildSpawnPlan(input())
    expect(JSON.parse(configValue(plan.args, 'mcp_servers.dsh.command') ?? '""')).toBe('/usr/bin/node')
    expect(JSON.parse(configValue(plan.args, 'mcp_servers.dsh.args') ?? '[]')).toEqual(['/plugin/lib/codex-mcp.js'])
    // `-c` values are parsed as TOML, so the env table must be TOML, not JSON
    // (a JSON object string fails with `invalid type: string ..., expected a map`).
    expect(configValue(plan.args, 'mcp_servers.dsh.env')).toBe(
      '{DSH_CODEX_URL="http://127.0.0.1:41234", DSH_CODEX_TOKEN="token-1", DSH_CODEX_INSTANCE="instance-1", DSH_CODEX_SESSION="session-1"}',
    )
  })

  it('forces a usable TERM and never overrides CODEX_HOME or approval policy', () => {
    const plan = buildSpawnPlan(input())
    expect(plan.env.TERM).toBe('xterm-256color')
    expect(plan.env.CODEX_HOME).toBe(process.env.CODEX_HOME)
    const joined = plan.args.join(' ')
    expect(joined).not.toContain('approval_policy')
    expect(joined).not.toContain('sandbox_mode')
  })
})
