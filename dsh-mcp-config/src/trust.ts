/**
 * Package-local copy of the connection plugin's /api browser-trust fence
 * (`packages/client/connection/src/api-request-trust.ts`). Applied to the
 * /api/mcp endpoints this plugin serves, because spawning MCP server
 * processes is host-level privilege. Kept local so the opt-in plugin remains
 * a pure add-on over the shipped composition.
 * TODO: extract one shared zero-dependency fence module and consume it here
 * and in client-connection; the two copies must stay behaviorally identical.
 */

/* jscpd:ignore-start */
import type { IncomingHttpHeaders } from 'node:http'

/** The request facts the fence reads. */
interface ApiTrustRequest {
  headers: IncomingHttpHeaders
}

/**
 * Whether a normalized URL hostname names the local loopback authority.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form.
 * @param entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry: string): void {
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`mcp-config: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a `trustedHosts` entry: exact on
 * `host:port` entries, any port on port-less entries.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Decide whether one request may reach a management endpoint: the Host must be
 * loopback or a declared authority (DNS-rebinding defense), an attached Origin
 * must equal the Host authority, and an explicit cross-site Fetch-Metadata
 * marker is refused.
 * @param request - Node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @returns true when the request is admissible.
 */
export function isTrustedApiRequest(request: ApiTrustRequest, trustedHosts: readonly string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
/* jscpd:ignore-end */

/**
 * Whether the request's Host names the local loopback authority.
 * @param request - Node HTTP request facts (headers).
 * @returns true when the Host is a loopback spelling.
 */
export function isLoopbackRequest(request: ApiTrustRequest): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  return hostUrl !== undefined && isLoopbackHostname(hostUrl.hostname)
}
