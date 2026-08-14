/**
 * Access-layer behavior through the real HTTP surface: a live webserver +
 * json storage stack + the plugin, driven with fetch/raw sockets, with
 * durable state re-read from the storage medium on disk.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as HostAuth from '../src/index.ts'

const RIGHT_KEY = 'test-access-key-1'
const SECOND_KEY = 'second-key-9'

const BASE_CONFIG = {
  accessKeys: [RIGHT_KEY, SECOND_KEY],
  sessionTtlMs: 3_600_000,
  trustedHosts: [] as string[],
  allowRemoteAdmin: false,
}

let root: string
let ctx: Context

async function boot(config: Partial<typeof BASE_CONFIG> = {}): Promise<number> {
  ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(HostAuth, { ...BASE_CONFIG, ...config })
  return ctx.get('webServer')!.port
}

interface JsonResponse {
  status: number
  body: unknown
  cookies: string[]
}

async function callJson(
  port: number,
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    redirect: 'manual',
  })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Non-JSON bodies (HTML pages, redirects) are asserted through status/text.
    body = text
  }
  return { status: response.status, body, cookies: response.headers.getSetCookie() }
}

function sessionCookie(response: JsonResponse): string {
  const cookie = response.cookies.find(value => value.startsWith('dsh_auth='))
  expect(cookie).toBeDefined()
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Strict')
  return cookie!.split(';', 1)[0]!
}

async function login(port: number, key: string = RIGHT_KEY): Promise<string> {
  const response = await callJson(port, '/api/auth/login', { method: 'POST', body: { key } })
  expect(response.status).toBe(200)
  return sessionCookie(response)
}

/** Raw request with full header control (fetch refuses to override Host). */
function rawRequest(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers,
      setHost: false,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    request.on('error', reject)
    request.end(options.body)
  })
}

async function readDomainFile(): Promise<string> {
  return readFile(join(root, 'storages', 'web_access.json'), 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-host-auth-'))
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('access-key login', () => {
  it('signs in with any configured key and persists only hashed tokens', async () => {
    const port = await boot()
    const cookie = await login(port)
    const me = await callJson(port, '/api/auth/me', { cookie })
    expect(me).toMatchObject({ status: 200, body: { authenticated: true } })

    const secondCookie = await login(port, SECOND_KEY)
    expect(secondCookie).not.toBe(cookie)

    // Verify the durable medium, not the response: neither the keys nor the
    // bearer tokens appear on disk, only token digests with expiries.
    const stored = await readDomainFile()
    expect(stored).toContain('expiresAt')
    expect(stored).not.toContain(RIGHT_KEY)
    expect(stored).not.toContain(SECOND_KEY)
    expect(stored).not.toContain(cookie.split('=')[1]!)
  })

  it('refuses a wrong key, bad shapes, and wrong methods', async () => {
    const port = await boot()
    const wrong = await callJson(port, '/api/auth/login', { method: 'POST', body: { key: 'not-the-key' } })
    expect(wrong).toMatchObject({ status: 401, body: { error: { code: 'invalid-credentials' } } })

    const wrongType = await callJson(port, '/api/auth/login', { method: 'POST', body: { key: 42 } })
    expect(wrongType).toMatchObject({ status: 400, body: { error: { code: 'invalid-request' } } })

    const malformed = await rawRequest(port, '/api/auth/login', {
      method: 'POST',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(malformed.status).toBe(400)

    const wrongMethod = await callJson(port, '/api/auth/login')
    expect(wrongMethod).toMatchObject({ status: 405, body: { error: { code: 'method-not-allowed' } } })
  })

  it('logs out: the token dies on the medium and the cookie is cleared', async () => {
    const port = await boot()
    const cookie = await login(port)

    const logout = await callJson(port, '/api/auth/logout', { method: 'POST', cookie })
    expect(logout.status).toBe(200)
    expect(logout.cookies.some(value => value.startsWith('dsh_auth=;') && value.includes('Max-Age=0'))).toBe(true)

    const me = await callJson(port, '/api/auth/me', { cookie })
    expect(me).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } })

    expect((await callJson(port, '/api/auth/logout', { method: 'POST' })).status).toBe(200)
    expect((await callJson(port, '/api/auth/logout')).status).toBe(405)
    expect((await callJson(port, '/api/auth/me', { method: 'POST' })).status).toBe(405)
    expect((await callJson(port, '/api/auth/me', { cookie: 'dsh_auth=' })).status).toBe(401)
  })

  it('keeps a session across a restart and expires it after sessionTtlMs', async () => {
    const port = await boot({ sessionTtlMs: 1000 })
    const cookie = await login(port)
    await ctx.fiber.dispose()

    const reopened = await boot({ sessionTtlMs: 1000 })
    expect((await callJson(reopened, '/api/auth/me', { cookie })).status).toBe(200)

    await delay(1100)
    expect((await callJson(reopened, '/api/auth/me', { cookie })).status).toBe(401)

    // The next sign-in sweeps expired tokens from the medium.
    await login(reopened)
    const stored = JSON.parse(await readDomainFile()) as { tables: { tokens: Record<string, unknown> } }
    expect(Object.keys(stored.tables.tokens)).toHaveLength(1)
  })

  it('fails loud on a too-short configured key', async () => {
    ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storages') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await expect(ctx.plugin(HostAuth, { ...BASE_CONFIG, accessKeys: ['short'] }))
      .rejects.toThrow(/at least 8 characters/)
  })
})

describe('page-managed keys', () => {
  it('walks first-run setup, lists keys, and stamps each key\'s last use on login', async () => {
    const port = await boot({ accessKeys: [] })
    expect((await callJson(port, '/api/auth/status')).body).toMatchObject({
      authenticated: false, needsSetup: true, canManageKey: true,
    })

    // First-run add-key needs no session; afterwards management requires one.
    const added = await callJson(port, '/api/auth/add-key', {
      method: 'POST',
      body: { key: 'page-key-123456', label: ' 小明 ' },
    })
    expect(added.status).toBe(200)
    expect(added.body).toMatchObject({ key: { label: '小明', lastUsedAt: null } })

    const anonymousAdd = await callJson(port, '/api/auth/add-key', { method: 'POST', body: { key: 'stolen-key-000' } })
    expect(anonymousAdd).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } })

    const before = Date.now()
    const cookie = await login(port, 'page-key-123456')

    const listed = await callJson(port, '/api/auth/keys', { cookie })
    expect(listed.status).toBe(200)
    const listedKey = (listed.body as { keys: { label: string; lastUsedAt: number | null }[] }).keys[0]!
    expect(listedKey.label).toBe('小明')
    expect(listedKey.lastUsedAt).toBeGreaterThanOrEqual(before)

    // The medium holds digests and timestamps, never plaintext keys.
    const stored = await readDomainFile()
    expect(stored).toContain('lastUsedAt')
    expect(stored).not.toContain('page-key-123456')
  })

  it('manages several keys: add with duplicate refusal, remove revokes new logins', async () => {
    const port = await boot({ accessKeys: [] })
    await callJson(port, '/api/auth/add-key', { method: 'POST', body: { key: 'first-key-1234', label: 'a' } })
    const cookie = await login(port, 'first-key-1234')

    const second = await callJson(port, '/api/auth/add-key', { method: 'POST', cookie, body: { key: 'second-key-567', label: 'b' } })
    expect(second.status).toBe(200)
    expect((await callJson(port, '/api/auth/login', { method: 'POST', body: { key: 'second-key-567' } })).status).toBe(200)

    const duplicate = await callJson(port, '/api/auth/add-key', { method: 'POST', cookie, body: { key: 'first-key-1234' } })
    expect(duplicate).toMatchObject({ status: 409, body: { error: { code: 'duplicate-key' } } })

    const listed = await callJson(port, '/api/auth/keys', { cookie })
    const keys = (listed.body as { keys: { id: string; label: string }[] }).keys
    expect(keys.map(key => key.label)).toEqual(['a', 'b'])

    const removed = await callJson(port, '/api/auth/remove-key', { method: 'POST', cookie, body: { id: keys[1]!.id } })
    expect(removed.status).toBe(200)
    expect((await callJson(port, '/api/auth/login', { method: 'POST', body: { key: 'second-key-567' } })).status).toBe(401)
    expect((await callJson(port, '/api/auth/login', { method: 'POST', body: { key: 'first-key-1234' } })).status).toBe(200)

    const unknown = await callJson(port, '/api/auth/remove-key', { method: 'POST', cookie, body: { id: 'nope' } })
    expect(unknown).toMatchObject({ status: 404, body: { error: { code: 'unknown-key' } } })
  })

  it('stamps deployment-config key use and lists those keys read-only', async () => {
    const port = await boot()
    const before = Date.now()
    const cookie = await login(port)

    const listed = await callJson(port, '/api/auth/keys', { cookie })
    const body = listed.body as { keys: unknown[]; configKeys: { index: number; lastUsedAt: number | null }[] }
    expect(body.keys).toEqual([])
    expect(body.configKeys).toHaveLength(2)
    expect(body.configKeys[0]!.lastUsedAt).toBeGreaterThanOrEqual(before)
    expect(body.configKeys[1]!.lastUsedAt).toBeNull()
  })

  it('bounds the page key list', async () => {
    const port = await boot({ accessKeys: [] })
    await callJson(port, '/api/auth/add-key', { method: 'POST', body: { key: 'seed-key-00000', label: 'seed' } })
    const cookie = await login(port, 'seed-key-00000')
    for (let index = 1; index < 20; index += 1) {
      const response = await callJson(port, '/api/auth/add-key', {
        method: 'POST',
        cookie,
        body: { key: `bulk-key-${index}-000` },
      })
      expect(response.status).toBe(200)
    }
    const overflow = await callJson(port, '/api/auth/add-key', { method: 'POST', cookie, body: { key: 'one-key-too-far' } })
    expect(overflow).toMatchObject({ status: 400, body: { error: { code: 'too-many-keys' } } })
  })

  it('refuses weak keys, wrong methods, and any non-loopback management request', async () => {
    const port = await boot({ accessKeys: [], trustedHosts: ['harness.internal'] })
    const weak = await callJson(port, '/api/auth/add-key', { method: 'POST', body: { key: 'short' } })
    expect(weak).toMatchObject({ status: 400, body: { error: { code: 'weak-key' } } })
    const badShape = await callJson(port, '/api/auth/add-key', { method: 'POST', body: { nope: true } })
    expect(badShape).toMatchObject({ status: 400, body: { error: { code: 'invalid-request' } } })
    expect((await callJson(port, '/api/auth/add-key')).status).toBe(405)
    expect((await callJson(port, '/api/auth/keys', { method: 'POST' })).status).toBe(405)

    // A trusted LAN authority passes the fence but never manages keys.
    const remote = await rawRequest(port, '/api/auth/add-key', {
      method: 'POST',
      headers: { host: 'harness.internal:9999', 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'remote-key-0000' }),
    })
    expect(remote.status).toBe(403)
    expect(remote.body).toContain('loopback-only')
    const remoteList = await rawRequest(port, '/api/auth/keys', {
      headers: { host: 'harness.internal:9999' },
    })
    expect(remoteList.status).toBe(403)

    const remoteStatus = await rawRequest(port, '/api/auth/status', {
      headers: { host: 'harness.internal:9999' },
    })
    expect(remoteStatus.body).toContain('"canManageKey":false')
  })
})

describe('allowRemoteAdmin', () => {
  // Register an /api route that echoes the Host the guard passed downstream.
  function mountEchoHost(): void {
    ctx.get('webServer')!.register({
      kind: 'exact',
      path: '/api/echo-host',
      handler: (req, res) => { res.writeHead(200); res.end(req.headers.host ?? '') },
    })
  }

  it('off (default): an authenticated /api request keeps its original Host downstream', async () => {
    const port = await boot()
    mountEchoHost()
    const cookie = await login(port)
    const echoed = await rawRequest(port, '/api/echo-host', {
      headers: { host: 'ds.example.com', cookie },
    })
    expect(echoed.body).toBe('ds.example.com')
  })

  it('on: an authenticated /api request is presented to downstream with a loopback Host', async () => {
    // Trust the domain so its /api/auth requests pass the browser-trust fence;
    // key management must still refuse them for not being loopback.
    const port = await boot({ allowRemoteAdmin: true, trustedHosts: ['ds.example.com'] })
    mountEchoHost()
    const cookie = await login(port)
    const echoed = await rawRequest(port, '/api/echo-host', {
      headers: { host: 'ds.example.com', cookie },
    })
    expect(echoed.body).toBe(`127.0.0.1:${port}`)

    // Key management stays host-machine-only even with the flag on and the Host
    // trusted: /api/auth is exempt from the rewrite and still judges the real Host.
    const remoteManage = await rawRequest(port, '/api/auth/add-key', {
      method: 'POST',
      headers: { host: 'ds.example.com', 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: 'should-be-refused-key' }),
    })
    expect(remoteManage.status).toBe(403)
    expect(remoteManage.body).toContain('loopback-only')
  })

  it('on: an unauthenticated /api request is still refused (no rewrite before auth)', async () => {
    const port = await boot({ allowRemoteAdmin: true })
    mountEchoHost()
    const anon = await rawRequest(port, '/api/echo-host', { headers: { host: 'ds.example.com' } })
    expect(anon.status).toBe(401)
  })
})

describe('the /api guard', () => {
  it('refuses unauthenticated /api requests 401 and admits them with a live session', async () => {
    const port = await boot()
    expect(await callJson(port, '/api/anything')).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    })

    const cookie = await login(port)
    // Admitted requests fall through to routing; with no /api route mounted in
    // this fixture the unclaimed-route 404 proves the guard stepped aside.
    expect((await callJson(port, '/api/anything', { cookie })).status).toBe(404)
    expect((await callJson(port, '/api/anything', { cookie: 'dsh_auth=forged' })).status).toBe(401)
  })

  it('redirects unauthenticated HTML navigations to /login and leaves subresources open', async () => {
    const port = await boot()
    const navigation = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
    })
    expect(navigation.status).toBe(302)
    expect(navigation.headers.get('location')).toBe('/login')
    await navigation.arrayBuffer()

    // fetch strips sec-* request headers, so the Fetch-Metadata arm goes raw.
    const fetchMetadata = await rawRequest(port, '/', {
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate' },
    })
    expect(fetchMetadata.status).toBe(302)

    expect((await callJson(port, '/assets/app.js')).status).toBe(404)
    expect((await callJson(port, '/api/auth')).status).toBe(404)

    // An unparsable request-target classifies as a plain page request.
    const malformed = await rawRequest(port, '//[', {
      headers: { host: `127.0.0.1:${port}`, accept: 'text/html' },
    })
    expect(malformed.status).toBe(302)
  })

  it('serves the /login page without a session and lets a signed-in navigation through', async () => {
    const port = await boot()
    const page = await callJson(port, '/login')
    expect(page.status).toBe(200)
    expect(String(page.body)).toContain('访问密钥')
    expect((await callJson(port, '/login', { method: 'POST' })).status).toBe(405)

    const cookie = await login(port)
    expect((await callJson(port, '/', { cookie, headers: { accept: 'text/html' } })).status).toBe(404)
  })

  it('gates /api upgrades on the session cookie', async () => {
    const port = await boot()
    for (const path of ['/api/probe', '/open-probe']) {
      ctx.get('webServer')!.registerUpgrade({
        path,
        handler: (_req, socket) => {
          socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n')
        },
      })
    }
    const cookie = await login(port)

    const upgrade = (path: string, headers: string): Promise<string> => new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(`GET ${path} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: Upgrade\r\nupgrade: probe\r\n${headers}\r\n`)
      })
      const chunks: Buffer[] = []
      socket.on('data', chunk => chunks.push(chunk))
      socket.on('close', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
      socket.on('error', reject)
    })

    expect(await upgrade('/api/probe', '')).toContain('401 Unauthorized')
    expect(await upgrade('/api/probe', `cookie: ${cookie}\r\n`)).toContain('101 Switching Protocols')
    // Upgrades outside /api are not the guard's concern.
    expect(await upgrade('/open-probe', '')).toContain('101 Switching Protocols')
  })
})

describe('the /api/auth browser-trust fence', () => {
  it('refuses rebound Hosts and cross-origin markers before any key logic', async () => {
    const port = await boot()
    const body = JSON.stringify({ key: RIGHT_KEY })
    const headers = { 'content-type': 'application/json' }

    const rebound = await rawRequest(port, '/api/auth/login', {
      method: 'POST',
      headers: { ...headers, host: 'evil.example' },
      body,
    })
    expect(rebound.status).toBe(403)
    expect(rebound.body).toContain('untrusted-request')

    const crossOrigin = await rawRequest(port, '/api/auth/login', {
      method: 'POST',
      headers: { ...headers, host: `127.0.0.1:${port}`, origin: 'http://evil.example' },
      body,
    })
    expect(crossOrigin.status).toBe(403)

    const crossSite = await rawRequest(port, '/api/auth/me', {
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)

    const logoutRebound = await rawRequest(port, '/api/auth/logout', {
      method: 'POST',
      headers: { host: 'evil.example' },
    })
    expect(logoutRebound.status).toBe(403)
  })

  it('admits a declared trusted authority and fails loud on a malformed entry', async () => {
    const port = await boot({ trustedHosts: ['harness.internal'] })
    const response = await rawRequest(port, '/api/auth/me', {
      headers: { host: 'harness.internal:9999' },
    })
    expect(response.status).toBe(401)
    await ctx.fiber.dispose()

    ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storages') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await expect(ctx.plugin(HostAuth, { ...BASE_CONFIG, trustedHosts: ['harness.internal/path'] }))
      .rejects.toThrow(/not a bare host\[:port\] authority/)
  })
})
