/**
 * Admission-guard mounting over an unmodified dsh webserver: the underlying
 * `node:http` server's `request`/`upgrade` listeners are captured, removed,
 * and re-invoked only for admitted requests, so the guard runs before every
 * route, the fallback, and every upgrade; the disposer restores the original
 * listeners. This reads the `WebServer` class's TypeScript-private `server`
 * field, which exists at runtime; a dsh release that renames it fails loud
 * here at plugin load instead of silently dropping protection.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
// Type-only import activates the webServer Context merge.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** The admission decision run before any route, fallback, or upgrade handler. */
export interface AdmissionGuard {
  /**
   * Decide one HTTP request's admission.
   * @param req - the incoming request, unconsumed.
   * @param res - the response; a refusing guard must answer it.
   * @returns true to dispatch normally; false after owning the response.
   */
  request(req: IncomingMessage, res: ServerResponse): boolean | Promise<boolean>
  /**
   * Decide one HTTP upgrade's admission.
   * @param req - the incoming upgrade request, unconsumed.
   * @param socket - the raw socket; a refusing guard must answer or destroy it.
   * @returns true to dispatch normally; false after owning the socket.
   */
  upgrade(req: IncomingMessage, socket: Duplex): boolean | Promise<boolean>
}

/** The runtime-reachable http server behind the WebServer service. */
interface WebServerInternals {
  server?: Server
}

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void
type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

/**
 * Mount the admission guard by wrapping the host webserver's listeners.
 * @param ctx - plugin context carrying `webServer`; the wrap is an effect on it.
 * @param guard - the admission decisions; refusal semantics follow {@link AdmissionGuard}.
 */
export function mountGuard(ctx: Context, guard: AdmissionGuard): void {
  const server = (ctx.webServer as unknown as WebServerInternals).server
  if (server === undefined) {
    throw new Error('host-auth: webServer does not expose its http server; incompatible dsh version')
  }
  ctx.effect(() => {
    const requestListeners = server.listeners('request') as RequestListener[]
    const upgradeListeners = server.listeners('upgrade') as UpgradeListener[]
    server.removeAllListeners('request')
    server.removeAllListeners('upgrade')
    // Failure containment mirrors the webserver's own per-request semantics:
    // a guard throw or rejection refuses the request (400) or destroys the
    // socket; it never escapes as an unhandled rejection.
    const onRequest: RequestListener = (req, res) => {
      Promise.resolve()
        .then(() => guard.request(req, res))
        .then((admitted) => {
          if (!admitted) return
          for (const listener of requestListeners) listener.call(server, req, res)
        })
        .catch(() => {
          if (res.headersSent) {
            res.destroy()
            return
          }
          res.writeHead(400)
          res.end()
        })
    }
    const onUpgrade: UpgradeListener = (req, socket, head) => {
      Promise.resolve()
        .then(() => guard.upgrade(req, socket))
        .then((admitted) => {
          if (!admitted) return
          for (const listener of upgradeListeners) listener.call(server, req, socket, head)
        })
        .catch(() => { socket.destroy() })
    }
    server.on('request', onRequest)
    server.on('upgrade', onUpgrade)
    return () => {
      server.removeListener('request', onRequest)
      server.removeListener('upgrade', onUpgrade)
      for (const listener of requestListeners) server.on('request', listener)
      for (const listener of upgradeListeners) server.on('upgrade', listener)
    }
  }, 'host-auth: admission guard (listener wrap)')
}
