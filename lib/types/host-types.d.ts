/**
 * Minimal structural mirrors of the DSH host services this plugin touches.
 *
 * Deliberately structural (not imports): the plugin must not depend on a second
 * copy of the DSH runtime packages, and a host that lacks one of these services
 * should degrade with a readable error instead of failing at import time.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
export interface HostUpgradeRoute {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}
export interface HostHttpRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface HostWebServer {
    register(route: HostHttpRoute): () => void;
    registerUpgrade(route: HostUpgradeRoute): () => void;
}
export interface HostToolDefinition {
    name: string;
    description: string;
    /** Model-facing JSON Schema for the arguments (same shape defineTool compiles to). */
    parameters: Record<string, unknown>;
    output: {
        schema: Record<string, unknown>;
        render(args: unknown, value: unknown): {
            type: string;
            text: string;
        }[];
    };
    execute(args: never, exec: {
        agent?: HostAgent;
    }): Promise<unknown>;
}
export interface HostTools {
    register(definition: HostToolDefinition): () => void;
}
export interface HostAgent {
    session: {
        id: string;
    };
    header?: {
        cwd?: string;
    };
    status?: string;
    followup(message: unknown): void;
}
export interface HostAgents {
    get(id: string): HostAgent | undefined;
}
export interface HostSessionPersistence {
    open(id: string, mode: 'read'): Promise<{
        header: {
            cwd?: string;
        } & Record<string, unknown>;
        read(): Promise<{
            events: unknown[];
        }>;
        close(): Promise<void>;
    }>;
}
export interface HostBridge {
    deliverExternal(from: string, to: string, text: string, options?: {
        id?: string;
        transport?: string;
    }): Promise<unknown>;
}
export interface HostWebRuntime {
    trustedHosts?: readonly string[];
}
export interface HostLogger {
    warn(message: string): void;
    info(message: string): void;
    error(message: string): void;
}
/** The slice of the cordis context this plugin uses. */
export interface HostContext {
    get(name: string): unknown;
    effect(callback: () => unknown): void;
    logger?(name: string): HostLogger;
    webServer: HostWebServer;
    tools: HostTools;
}
