import { describe, expect, it } from 'vitest'
import { hostnameOf, isLoopbackHost, isTrustedRequest } from '../src/trust-fence.ts'

/** Minimal IncomingMessage stand-in: the fence only reads headers. */
function req(headers: Record<string, string>): Parameters<typeof isTrustedRequest>[0] {
  return { headers } as unknown as Parameters<typeof isTrustedRequest>[0]
}

describe('hostnameOf', () => {
  it('strips ports and IPv6 brackets', () => {
    expect(hostnameOf('127.0.0.1:9000')).toBe('127.0.0.1')
    expect(hostnameOf('[::1]:9000')).toBe('::1')
    expect(hostnameOf('example.com')).toBe('example.com')
  })
})

describe('isLoopbackHost', () => {
  it('accepts loopback literals', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('127.1.2.3')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isLoopbackHost('10.0.0.5')).toBe(false)
    expect(isLoopbackHost('evil.example')).toBe(false)
    expect(isLoopbackHost('128.0.0.1')).toBe(false)
    expect(isLoopbackHost('999.0.0.1')).toBe(false)
  })
})

describe('isTrustedRequest', () => {
  it('allows a same-origin loopback browser request', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:9000', origin: 'http://127.0.0.1:9000' }), [])).toBe(true)
  })

  it('allows a headerless local client (curl, the MCP shim path)', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:9000' }), [])).toBe(true)
  })

  it('rejects cross-site fetch metadata', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:9000', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
  })

  it('rejects an Origin whose host differs from Host (cross-site WS hijack)', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:9000', origin: 'http://evil.example' }), [])).toBe(false)
    expect(isTrustedRequest(req({ host: '127.0.0.1:9000', origin: 'not a url' }), [])).toBe(false)
  })

  it('rejects a foreign Host that DSH does not trust', () => {
    expect(isTrustedRequest(req({ host: '10.0.0.5:9000' }), [])).toBe(false)
  })

  it('accepts a LAN authority DSH trusts, and only with a matching Origin', () => {
    expect(isTrustedRequest(req({ host: '10.0.0.5:9000', origin: 'http://10.0.0.5:9000' }), ['10.0.0.5'])).toBe(true)
    expect(isTrustedRequest(req({ host: '10.0.0.5:9000', origin: 'http://10.0.0.6:9000' }), ['10.0.0.5'])).toBe(false)
  })

  it('rejects an absent or empty Host', () => {
    expect(isTrustedRequest(req({}), [])).toBe(false)
    expect(isTrustedRequest(req({ host: '' }), [])).toBe(false)
  })
})
