/**
 * The `codex_*` tools DSH agents call.
 *
 * Definitions are plain objects (the same shape `defineTool` compiles to) on
 * purpose: this plugin must not import a second copy of the DSH runtime packages
 * into the host process, and `tools.register()` only requires
 * `{ name, description, parameters, output: { schema, render }, execute }`.
 *
 * Instance resolution is per calling session (`exec.agent.session.id`): the
 * binding is 1:1, so a tool never has to be told which codex it means.
 */
import type { CodexInstance, CodexRegistry } from './registry.ts';
import type { HostToolDefinition } from './host-types.ts';
import { deliverToCodex } from './deliver.ts';
import type { SpawnInput } from './spawn.ts';
export interface ToolDeps {
    registry: CodexRegistry;
    codexPath: string;
    /** Resolve (or mint) a spawn input for a session — used by codex_restart. */
    prepare(sessionId: string): Promise<{
        spawn: SpawnInput;
    }>;
    /** Delivery implementation; tests inject a stub. */
    deliver?: typeof deliverToCodex;
    /** Rollout discovery (the `codex queue` path needs codex's own thread id). */
    discoverThreadId?: (instance: CodexInstance) => Promise<string | undefined>;
    now?(): number;
}
export declare function createCodexTools(deps: ToolDeps): HostToolDefinition[];
