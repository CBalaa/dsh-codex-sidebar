import type { CodexRegistry } from './registry.ts';
import { type DeliverToDshDeps } from './to-dsh.ts';
export interface LoopbackHandle {
    /** Base URL, e.g. http://127.0.0.1:41234 (resolves once listening). */
    url(): string;
    /** Whether the server is listening (spawn preparation awaits `ready`). */
    ready: Promise<void>;
    tokenFor(instanceId: string): string;
    close(): Promise<void>;
}
export declare function createLoopback(input: {
    registry: CodexRegistry;
    deps: DeliverToDshDeps;
}): LoopbackHandle;
