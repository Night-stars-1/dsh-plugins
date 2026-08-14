/**
 * HTTP plumbing for the /api/auth endpoints: cookie parsing/serialization,
 * bounded JSON body reading, and JSON responses. The session cookie is
 * HttpOnly and SameSite=Strict; it never carries a Secure attribute because
 * the webserver serves plain HTTP (the shipped posture is loopback).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Session cookie name shared by the endpoints, the guard, and the login page. */
export const AUTH_COOKIE_NAME = 'dsh_auth'

/**
 * Parse one Cookie request header.
 * @param header - the raw `cookie` header, or undefined when absent.
 * @returns cookie values by name; later duplicates win, values verbatim.
 */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>()
  if (header === undefined) return cookies
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')
    if (separator === -1) continue
    const cookieName = pair.slice(0, separator).trim()
    if (cookieName === '') continue
    cookies.set(cookieName, pair.slice(separator + 1).trim())
  }
  return cookies
}

/**
 * Serialize the session Set-Cookie value carrying one bearer token.
 * @param token - the bearer token (base64url, cookie-safe by construction).
 * @param maxAgeSeconds - cookie lifetime matching the stored token expiry.
 * @returns the Set-Cookie header value.
 */
export function authCookie(token: string, maxAgeSeconds: number): string {
  return `${AUTH_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict`
}

/**
 * Serialize the Set-Cookie value that deletes the session cookie.
 * @returns the expiring Set-Cookie header value.
 */
export function clearedAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`
}

/**
 * Read and parse one bounded JSON request body.
 * @param req - the incoming request, unconsumed.
 * @param maxBytes - refusal bound applied to the accumulated raw body; a body over it destroys the connection.
 * @returns the parsed value, or undefined when the body exceeds the bound, is not valid JSON, or the stream errors.
 */
export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let received = 0
    let settled = false
    const settle = (value: unknown): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > maxBytes) {
        settle(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        // Malformed JSON is a caller error answered as invalid-request; the
        // failed parse carries no other information worth propagating.
        settle(undefined)
      }
    })
    // 'close' fires on every teardown path (abort, reset, and after 'end');
    // settle is first-wins, so a completed parse is never overwritten.
    req.on('close', () => { settle(undefined) })
  })
}

/**
 * Answer one request with a JSON body.
 * @param res - the response to own.
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
