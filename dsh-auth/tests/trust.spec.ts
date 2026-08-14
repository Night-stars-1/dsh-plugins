/**
 * Behavior of the package-local /api/auth browser-trust fence; mirrors the
 * decisive cases of the client-connection original the copy must match.
 */

import { describe, expect, it } from 'vitest'
import { assertTrustedAuthority, isTrustedApiRequest } from '../src/trust.ts'

function request(headers: Record<string, string | undefined>): { headers: Record<string, string | undefined> } {
  return { headers }
}

describe('isTrustedApiRequest', () => {
  it('holds markerless requests to the Host fence and accepts loopback spellings', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'localhost' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: '[::1]:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: '192.168.1.5:3080' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'harness.example' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({}), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'bad host' }), [])).toBe(false)
  })

  it('matches trustedHosts entries: exact on host:port, any port on port-less, WHATWG-normalized', () => {
    const headers = { host: 'harness.internal:3080', origin: 'http://harness.internal:3080' }
    expect(isTrustedApiRequest(request(headers), ['harness.internal:3080'])).toBe(true)
    expect(isTrustedApiRequest(request(headers), ['harness.internal'])).toBe(true)
    expect(isTrustedApiRequest(request(headers), ['harness.internal:9999'])).toBe(false)
    expect(isTrustedApiRequest(request(headers), ['bad entry', 'HARNESS.INTERNAL'])).toBe(true)
    expect(isTrustedApiRequest(request(headers), ['bad entry'])).toBe(false)
    expect(isTrustedApiRequest(request(headers), [])).toBe(false)
  })

  it('refuses cross-origin markers even on a loopback Host', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1', origin: 'http://evil.example' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: '127.0.0.1', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: '127.0.0.1', origin: 'null' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: '127.0.0.1', origin: 'http://127.0.0.1' }), [])).toBe(true)
  })
})

describe('assertTrustedAuthority', () => {
  it('accepts bare canonical authorities and throws on anything parsing would rewrite', () => {
    for (const entry of ['harness.internal', 'harness.internal:3080', '10.0.0.9', '[::1]:3080']) {
      expect(() => { assertTrustedAuthority(entry) }).not.toThrow()
    }
    for (const entry of ['harness.internal/path', 'user@harness.internal', ' harness.internal', 'harness.internal:', 'harness.internal:0080', '0x7f.0.0.1', 'bad entry', '']) {
      expect(() => { assertTrustedAuthority(entry) }).toThrow(/not a bare host\[:port\] authority/)
    }
  })
})
