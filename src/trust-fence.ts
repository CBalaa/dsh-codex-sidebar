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
import type { IncomingMessage } from 'node:http'

/** Strip the port (and IPv6 brackets) from a Host/authority value. */
export function hostnameOf(authority: string): string {
  const value = authority.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(1, end)
  }
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

/** Whether a hostname is a loopback literal. */
export function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (match === null) return false
  const octets = match.slice(1).map(Number)
  return octets.every((part) => part <= 255) && octets[0] === 127
}

/** Whether a request may reach the codex terminal / codex API. */
export function isTrustedRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const hostname = hostnameOf(host)
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let originHost: string
    try {
      originHost = new URL(origin).hostname
    } catch {
      return false
    }
    if (originHost !== hostname) return false
  }
  if (isLoopbackHost(hostname)) return true
  return trustedHosts.includes(hostname) || trustedHosts.includes(host)
}
