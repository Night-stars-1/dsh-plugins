/**
 * @night-stars-1/dsh-host-auth — third-party dsh Web access plugin. Admission
 * is a pre-shared access key: /api/auth/login matches the submitted key
 * against the deployment-config `accessKeys` and the page-managed key records
 * and issues a hashed session token in the `web_access` storage domain plus
 * the HttpOnly SameSite=Strict `dsh_auth` cookie; there is no registration
 * and no account data. Every successful login stamps the matched key's last
 * use. Key management (/api/auth/keys, add-key, remove-key) is
 * loopback-only: first-run add-key needs no session because none can exist,
 * and afterwards a live session is required. The served /login page drives
 * login and first-run setup; the browser half's settings section manages the
 * key list. An admission guard mounted over the stock webserver
 * ({@link mountGuard}, listener wrapping) refuses unauthenticated /api
 * requests (401) and upgrades and redirects unauthenticated HTML navigations
 * to /login, while static assets stay open so the login page and app shell
 * load. The /api/auth endpoints pass a package-local browser-trust fence
 * (Host/Origin/Fetch-Metadata) because they run before any session exists;
 * every other /api entry keeps the connection plugin's own fence after this
 * guard admits it.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only import activates the storageDomain Context merge.
import type {} from '@deepseek-ai/dsh-storage-domain'
import { assertAccessKey, keyDigestHex, matchKey, MIN_ACCESS_KEY_LENGTH, type KeyMatch } from './access-key.ts'
import { mountGuard, type AdmissionGuard } from './guard-mount.ts'
import { authCookie, AUTH_COOKIE_NAME, clearedAuthCookie, parseCookieHeader, readJsonBody, sendJson } from './http.ts'
import { renderLoginPage } from './login-page.ts'
import { tokenKey, webAccessDomainSpec, type WebAccessKeyState } from './spec.ts'
import { assertTrustedAuthority, isLoopbackRequest, isTrustedApiRequest } from './trust.ts'
import type { WebAuthErrorCode } from './types.ts'

export type * from './types.ts'
export { AUTH_COOKIE_NAME } from './http.ts'

/** The served login page path, exempt from the guard. */
export const LOGIN_PATH = '/login'
/** The access endpoint prefix, exempt from the guard. */
export const AUTH_PREFIX = '/api/auth'

const API_PREFIX = '/api'
// Bound on /api/auth request bodies; a key object fits far below it.
const MAX_BODY_BYTES = 4096
const TOKEN_BYTES = 32
/** Bound on page-managed keys; enough for per-person keys on a small deployment. */
const MAX_PAGE_KEYS = 20
/** Bound on a page key's label. */
const MAX_LABEL_LENGTH = 64

/** Cordis plugin name. */
export const name = 'host-auth'
/** Services required before activation. */
export const inject = ['webServer', 'storageDomain']

/** Deployment policy for the access layer. */
export interface Config {
  /** Accepted access keys from deployment config, each at least 8 characters; page-managed keys work alongside, so the list may be empty. */
  accessKeys: string[]
  /** Session token lifetime in milliseconds; the cookie Max-Age mirrors it. */
  sessionTtlMs: number
  /** Non-loopback authorities admitted by the /api/auth fence; the connection plugin's bare `host[:port]` trustedHosts vocabulary. */
  trustedHosts: string[]
}

/** Loader validation for {@link Config}. */
export const Config: z<Config> = z.object({
  accessKeys: z.array(z.string()).default([]),
  sessionTtlMs: z.natural().min(1000).required(),
  trustedHosts: z.array(z.string()).default([]),
})

/**
 * Plugin body: open the session domain, mount the /login page and /api/auth
 * routes, and mount the admission guard.
 * @param ctx - Host plugin context carrying webServer and storageDomain.
 * @param config - resolved deployment policy (schema defaults applied).
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  for (const key of config.accessKeys) assertAccessKey(key)
  for (const entry of config.trustedHosts) assertTrustedAuthority(entry)
  const domain = await ctx.storageDomain.open(webAccessDomainSpec)
  ctx.effect(() => async () => { await domain.close() }, 'host-auth.domainClose')
  const tokens = domain.table('tokens')

  const errorBody = (code: WebAuthErrorCode): { error: { code: WebAuthErrorCode } } => ({ error: { code } })

  const keyState = (): WebAccessKeyState => domain.global.get()
  const hasAnyKey = (): boolean => config.accessKeys.length > 0 || keyState().keys.length > 0
  const matchSubmitted = (candidate: string): KeyMatch | undefined =>
    matchKey(candidate, config.accessKeys, keyState().keys)

  /** Stamp the matched key's last use (page record, or the config-key usage map). */
  const recordUse = async (match: KeyMatch): Promise<void> => {
    const state = keyState()
    const now = Date.now()
    if (match.kind === 'page') {
      await domain.global.set({
        ...state,
        keys: state.keys.map(key => key.id === match.id ? { ...key, lastUsedAt: now } : key),
      })
      return
    }
    await domain.global.set({
      ...state,
      configKeyUsage: { ...state.configKeyUsage, [match.digestHex]: now },
    })
  }

  const cookieToken = (req: IncomingMessage): string | undefined => {
    const token = parseCookieHeader(req.headers.cookie).get(AUTH_COOKIE_NAME)
    return token === '' ? undefined : token
  }

  const authenticated = (req: IncomingMessage): boolean => {
    const token = cookieToken(req)
    if (token === undefined) return false
    const record = tokens.get(tokenKey(token))
    return record !== undefined && record.expiresAt > Date.now()
  }

  const sweepExpiredTokens = async (): Promise<void> => {
    const now = Date.now()
    const expired = [...tokens.entries()].filter(([, record]) => record.expiresAt <= now)
    for (const [key] of expired) await tokens.delete(key)
  }

  const issueSession = async (res: ServerResponse): Promise<void> => {
    await sweepExpiredTokens()
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    await tokens.put(tokenKey(token), { expiresAt: Date.now() + config.sessionTtlMs })
    res.setHeader('set-cookie', authCookie(token, Math.floor(config.sessionTtlMs / 1000)))
  }

  const admit = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isTrustedApiRequest(req, config.trustedHosts)) return true
    sendJson(res, 403, errorBody('untrusted-request'))
    return false
  }

  /** Shared admission for key management: POST + loopback + (session unless first-run). */
  const admitManagement = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!admit(req, res)) return false
    if (req.method !== 'POST') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return false
    }
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, errorBody('loopback-only'))
      return false
    }
    if (hasAnyKey() && !authenticated(req)) {
      sendJson(res, 401, errorBody('unauthenticated'))
      return false
    }
    return true
  }

  const readBodyObject = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (typeof body !== 'object' || body === null) return undefined
    return body as Record<string, unknown>
  }

  const handleLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admit(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    const body = await readBodyObject(req)
    const submitted = body?.key
    if (typeof submitted !== 'string') {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    const match = matchSubmitted(submitted)
    if (match === undefined) {
      sendJson(res, 401, errorBody('invalid-credentials'))
      return
    }
    await recordUse(match)
    await issueSession(res)
    sendJson(res, 200, { authenticated: true })
  }

  const handleLogout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admit(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    const token = cookieToken(req)
    if (token !== undefined) await tokens.delete(tokenKey(token))
    res.setHeader('set-cookie', clearedAuthCookie())
    sendJson(res, 200, {})
  }

  const handleMe = (req: IncomingMessage, res: ServerResponse): void => {
    if (!admit(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    if (!authenticated(req)) {
      sendJson(res, 401, errorBody('unauthenticated'))
      return
    }
    sendJson(res, 200, { authenticated: true })
  }

  const handleStatus = (req: IncomingMessage, res: ServerResponse): void => {
    if (!admit(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    const signedIn = authenticated(req)
    const needsSetup = !hasAnyKey()
    sendJson(res, 200, {
      authenticated: signedIn,
      needsSetup,
      // Key management stays host-machine-only, and (past first-run setup)
      // requires a live session.
      canManageKey: isLoopbackRequest(req) && (signedIn || needsSetup),
    })
  }

  const handleKeys = (req: IncomingMessage, res: ServerResponse): void => {
    if (!admit(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, errorBody('loopback-only'))
      return
    }
    if (hasAnyKey() && !authenticated(req)) {
      sendJson(res, 401, errorBody('unauthenticated'))
      return
    }
    const state = keyState()
    sendJson(res, 200, {
      keys: state.keys.map(({ id, label, createdAt, lastUsedAt }) => ({ id, label, createdAt, lastUsedAt })),
      configKeys: config.accessKeys.map((key, index) => ({
        index,
        lastUsedAt: state.configKeyUsage[keyDigestHex(key)] ?? null,
      })),
    })
  }

  const handleAddKey = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admitManagement(req, res)) return
    const body = await readBodyObject(req)
    const submitted = body?.key
    if (typeof submitted !== 'string' || (body?.label !== undefined && typeof body.label !== 'string')) {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    if (submitted.length < MIN_ACCESS_KEY_LENGTH) {
      sendJson(res, 400, errorBody('weak-key'))
      return
    }
    const state = keyState()
    if (state.keys.length >= MAX_PAGE_KEYS) {
      sendJson(res, 400, errorBody('too-many-keys'))
      return
    }
    if (matchSubmitted(submitted) !== undefined) {
      sendJson(res, 409, errorBody('duplicate-key'))
      return
    }
    const label = typeof body?.label === 'string' ? body.label.trim().slice(0, MAX_LABEL_LENGTH) : ''
    const record = {
      id: randomUUID(),
      label,
      digestHex: keyDigestHex(submitted),
      createdAt: Date.now(),
      lastUsedAt: null,
    }
    await domain.global.set({ ...state, keys: [...state.keys, record] })
    sendJson(res, 200, { key: { id: record.id, label: record.label, createdAt: record.createdAt, lastUsedAt: null } })
  }

  const handleRemoveKey = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admitManagement(req, res)) return
    const body = await readBodyObject(req)
    const id = body?.id
    if (typeof id !== 'string') {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    const state = keyState()
    if (!state.keys.some(key => key.id === id)) {
      sendJson(res, 404, errorBody('unknown-key'))
      return
    }
    await domain.global.set({ ...state, keys: state.keys.filter(key => key.id !== id) })
    sendJson(res, 200, {})
  }

  const handleLoginPage = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(renderLoginPage())
  }

  const requestPathname = (req: IncomingMessage): string => {
    try {
      return new URL(req.url ?? '/', 'http://x').pathname
    } catch {
      // An unparsable request-target names no exempt or API path; the guard
      // treats it as an ordinary unauthenticated page request.
      return '/'
    }
  }

  const isApiPath = (pathname: string): boolean =>
    pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)
  const isExemptPath = (pathname: string): boolean =>
    pathname === LOGIN_PATH || pathname === AUTH_PREFIX || pathname.startsWith(`${AUTH_PREFIX}/`)
  const isHtmlNavigation = (req: IncomingMessage): boolean =>
    req.headers['sec-fetch-mode'] === 'navigate'
    || (typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html'))

  const guard: AdmissionGuard = {
    request(req: IncomingMessage, res: ServerResponse): boolean {
      const pathname = requestPathname(req)
      if (isExemptPath(pathname)) return true
      if (authenticated(req)) return true
      if (isApiPath(pathname)) {
        sendJson(res, 401, errorBody('unauthenticated'))
        return false
      }
      if (isHtmlNavigation(req)) {
        res.writeHead(302, { location: LOGIN_PATH })
        res.end()
        return false
      }
      // Non-HTML subresources (scripts, styles, plugin bundles) stay open:
      // they carry app code, not user data, and the login page needs the
      // page load to succeed before any session exists.
      return true
    },
    upgrade(req: IncomingMessage, socket: Duplex): boolean {
      if (!isApiPath(requestPathname(req))) return true
      if (authenticated(req)) return true
      socket.end('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
      return false
    },
  }

  const routes = [
    { path: LOGIN_PATH, handler: handleLoginPage },
    { path: `${AUTH_PREFIX}/login`, handler: handleLogin },
    { path: `${AUTH_PREFIX}/logout`, handler: handleLogout },
    { path: `${AUTH_PREFIX}/me`, handler: handleMe },
    { path: `${AUTH_PREFIX}/status`, handler: handleStatus },
    { path: `${AUTH_PREFIX}/keys`, handler: handleKeys },
    { path: `${AUTH_PREFIX}/add-key`, handler: handleAddKey },
    { path: `${AUTH_PREFIX}/remove-key`, handler: handleRemoveKey },
  ]
  for (const route of routes) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }),
      `host-auth: ${route.path} route`,
    )
  }
  mountGuard(ctx, guard)
}
