/** Cookie and bounded-body plumbing behavior. */

import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { authCookie, clearedAuthCookie, parseCookieHeader, readJsonBody, sendJson } from '../src/http.ts'

describe('parseCookieHeader', () => {
  it('parses names, trims whitespace, keeps later duplicates, and skips malformed pairs', () => {
    expect(parseCookieHeader(undefined).size).toBe(0)
    const cookies = parseCookieHeader('a=1; dsh_auth = token== ; broken; =empty; a=2')
    expect(cookies.get('a')).toBe('2')
    expect(cookies.get('dsh_auth')).toBe('token==')
    expect(cookies.has('broken')).toBe(false)
    expect(cookies.has('')).toBe(false)
  })
})

describe('cookie serialization', () => {
  it('sets and clears the HttpOnly SameSite=Strict session cookie', () => {
    expect(authCookie('tok', 60)).toBe('dsh_auth=tok; Max-Age=60; Path=/; HttpOnly; SameSite=Strict')
    expect(clearedAuthCookie()).toBe('dsh_auth=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict')
  })
})

describe('readJsonBody + sendJson', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
    server = undefined
  })

  async function roundTrip(body: string, maxBytes: number): Promise<{ status: number; echoed: unknown }> {
    const listening = createServer((req, res) => {
      void readJsonBody(req, maxBytes).then((value) => {
        sendJson(res, 200, { echoed: value ?? null })
      })
    })
    server = listening
    await new Promise<void>((resolve) => { listening.listen(0, '127.0.0.1', resolve) })
    const port = (listening.address() as AddressInfo).port
    return new Promise((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/' }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            echoed: (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { echoed: unknown }).echoed,
          })
        })
      })
      request.on('error', reject)
      request.end(body)
    })
  }

  it('parses a bounded JSON body', async () => {
    expect((await roundTrip('{"a":1}', 1024)).echoed).toEqual({ a: 1 })
  })

  it('answers undefined for malformed JSON and destroys the connection on a body over the bound', async () => {
    expect((await roundTrip('not json', 1024)).echoed).toBeNull()
    await expect(roundTrip(JSON.stringify({ pad: 'x'.repeat(64) }), 16)).rejects.toThrow()
  })

  it('resolves undefined when the client aborts mid-body instead of hanging the handler', async () => {
    let sawBody: (value: unknown) => void
    const seen = new Promise<unknown>((resolve) => { sawBody = resolve })
    const listening = createServer((req) => {
      void readJsonBody(req, 1024).then(sawBody)
    })
    server = listening
    await new Promise<void>((resolve) => { listening.listen(0, '127.0.0.1', resolve) })
    const port = (listening.address() as AddressInfo).port
    const socket = connect(port, '127.0.0.1', () => {
      socket.write('POST / HTTP/1.1\r\nhost: x\r\ncontent-length: 100\r\n\r\n{"partial')
      setTimeout(() => { socket.destroy() }, 25)
    })
    expect(await seen).toBeUndefined()
  })
})
