/**
 * Upgrade fence for /codex-sidebar/ws (and the HTTP API in src/http.ts).
 *
 * dsh-auth-gate authenticates but does NOT defend DNS rebinding or cross-site
 * WebSocket hijacking: a hostile page can open a WebSocket to this host and the
 * browser attaches the session cookie automatically (WS handshakes are not
 * subject to CORS). So the plugin owns its own fence:
 *
 * - `Sec-Fetch-Site: cross-site` is rejected outright;
 * - when an Origin is present its hostname must equal the Host hostname;
 * - the Host must be loopback, or an authority DSH already trusts (the LAN IP
 *   literals the web runtime derives when the webserver binds 0.0.0.0).
 *
 * This is a DNS-rebinding / cross-site defence, not authentication.
 */
import type { IncomingMessage } from 'node:http';
/** Strip the port (and IPv6 brackets) from a Host/authority value. */
export declare function hostnameOf(authority: string): string;
/** Whether a hostname is a loopback literal. */
export declare function isLoopbackHost(hostname: string): boolean;
/** Whether a request may reach the codex terminal / codex API. */
export declare function isTrustedRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean;
