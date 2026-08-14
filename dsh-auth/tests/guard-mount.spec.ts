/** Guard mounting: listener wrap/restore and the incompatible-host refusal. */

import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountGuard, type AdmissionGuard } from '../src/guard-mount.ts'

const NOOP_GUARD: AdmissionGuard = {
  request: () => true,
  upgrade: () => true,
}

describe('mountGuard', () => {
  it('wraps the http server listeners and restores them on dispose', async () => {
    const ctx = new Context()
    const server = createServer(() => {})
    const original = server.listeners('request')
    expect(original).toHaveLength(1)
    ctx.provide('webServer', { server })

    mountGuard(ctx, NOOP_GUARD)
    expect(server.listeners('request')).toHaveLength(1)
    expect(server.listeners('request')[0]).not.toBe(original[0])
    expect(server.listeners('upgrade')).toHaveLength(1)

    await ctx.fiber.dispose()
    expect(server.listeners('request')).toHaveLength(1)
    expect(server.listeners('request')[0]).toBe(original[0])
    expect(server.listeners('upgrade')).toHaveLength(0)
  })

  it('fails loud when the http server is not reachable', () => {
    const ctx = new Context()
    ctx.provide('webServer', {})
    expect(() => { mountGuard(ctx, NOOP_GUARD) }).toThrow(/incompatible dsh version/)
  })
})
