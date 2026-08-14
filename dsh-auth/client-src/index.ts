/**
 * Browser half of @night-stars-1/dsh-host-auth: registers the "访问密钥"
 * page into the settings dialog's `settings.section` slot. The section drives
 * the plugin's own /api/auth endpoints with same-origin fetch, so it needs no
 * remote namespace and is unaffected by the API proxy's settings allowlist.
 */

import { AccessKeySection } from './AccessKeySection.tsx'
import { installMobileShellStyles } from './mobile-shell.ts'

/** Minimal structural view of the client context this plugin touches. */
interface ClientSlots {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface ClientContext {
  slots: ClientSlots
}

/** Cordis plugin name. */
export const name = 'host-auth-ui'
/** Required client services. */
export const inject = ['slots']

/**
 * Client plugin body: contribute the settings section.
 * @param ctx - client cordis context carrying the slot registry.
 */
export function apply(ctx: ClientContext): void {
  installMobileShellStyles()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'host-auth',
    order: 80,
    label: () => '访问密钥',
  }, AccessKeySection))
}
