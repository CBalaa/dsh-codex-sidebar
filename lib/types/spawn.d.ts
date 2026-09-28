export interface SpawnInput {
    /** Absolute path to this plugin's built MCP shim (lib/codex-mcp.js). */
    shimPath: string;
    /** Node executable that runs the shim (the DSH host's own node). */
    nodePath: string;
    sessionId: string;
    instanceId: string;
    cwd: string;
    loopbackUrl: string;
    loopbackToken: string;
    /** codex executable, resolved from PATH by the caller. */
    codexPath: string;
    /** The user's own developer_instructions, when their config.toml sets one. */
    userDeveloperInstructions?: string;
}
export interface SpawnPlan {
    file: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd: string;
}
/** Build the codex argv/env for one instance. */
export declare function buildSpawnPlan(input: SpawnInput): SpawnPlan;
