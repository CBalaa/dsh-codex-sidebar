import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from './host-types.ts';
export declare const name = "dsh-codex-sidebar";
export declare const inject: string[];
/** Resolve the codex executable from the host's own PATH. */
export declare function resolveCodex(pathValue?: string): string;
/**
 * The user's own `developer_instructions`, when their ~/.codex/config.toml sets
 * one. We APPEND it after our identity text rather than letting `-c` clobber
 * it. A minimal top-level TOML scan is enough here: the value is a single-line
 * string, and anything more exotic is left alone (the key then simply is not
 * appended, and our injection still stands).
 */
export declare function userDeveloperInstructions(configPath?: string): string | undefined;
/** Session cwd: live header first, then the client hint, then the persisted header. */
export declare function sessionCwdOf(host: HostContext, sessionId: string, hint?: string): Promise<string>;
export declare function apply(ctx: Context): void;
