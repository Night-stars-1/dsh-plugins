/**
 * HTTP plumbing for the /api/mcp endpoints: bounded JSON body reading
 * and JSON responses. No cookies — admission is decided by the trust fence
 * (and, when dsh-auth is installed, by its /api session guard which runs
 * before any named route).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Read and parse one bounded JSON request body.
 * @param req - the incoming request, unconsumed.
 * @param maxBytes - refusal bound applied to the accumulated raw body.
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
        settle(undefined)
      }
    })
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
