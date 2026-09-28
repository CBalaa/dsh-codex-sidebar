import type { IPty } from 'node-pty';
export interface NodePtyModule {
    spawn(file: string, args: string[] | string, options: Record<string, unknown>): IPty;
}
/**
 * Restore the executable bit pnpm strips from node-pty's spawn-helper (the
 * macOS helper that forks and sets up the pty). Without it every spawn fails
 * with `posix_spawnp failed`. Same fix better-sidebar applies at activation
 * (src/pty-manager.ts:27-44), kept here because a link-installed deployment
 * never runs node-pty's own postinstall.
 */
export declare function ensureSpawnHelper(): void;
/** Load node-pty once; throws a readable error when the native module is absent. */
export declare function loadNodePty(): Promise<NodePtyModule>;
