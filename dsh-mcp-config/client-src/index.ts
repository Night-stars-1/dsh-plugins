/**
 * Browser half of @night-stars-1/dsh-mcp-config: registers the "MCP 服务器"
 * page into the settings dialog's `settings.section` slot. The section drives
 * the plugin's own /api/mcp endpoints with same-origin fetch.
 */

import { McpSection } from './McpSection.tsx'

/** Minimal structural view of the client context this plugin touches. */
interface ClientSlots {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface ClientContext {
  slots: ClientSlots
}

/** Cordis plugin name. */
export const name = 'mcp-config-ui'
/** Required client services. */
export const inject = ['slots']

/**
 * Client plugin body: contribute the settings section.
 * @param ctx - client cordis context carrying the slot registry.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-config',
    order: 90,
    label: () => 'MCP 服务器',
  }, McpSection))
}
