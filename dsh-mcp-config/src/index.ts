/**
 * @night-stars-1/dsh-mcp-config — third-party dsh MCP server manager. The
 * host half owns the durable roster (a storage-domain `global` record),
 * hot-applies it as live `@deepseek-ai/dsh-mcp-client` instances (one per
 * server, tools land in the host-plane/global tool layer), and serves the
 * /api/mcp endpoints the settings page drives. Management is gated by
 * the browser-trust fence: loopback only by default, or loopback plus
 * `trustedHosts` when `allowRemoteManage` is set — spawning MCP server
 * processes is host-level privilege. When dsh-auth is installed its /api
 * session guard runs first, so management also requires a live session.
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
// Type-only import activates the webServer Context merge.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only import activates the storageDomain Context merge.
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { assertTrustedAuthority, isLoopbackRequest, isTrustedApiRequest } from './trust.ts'
import { readJsonBody, sendJson } from './http.ts'
import { mcpConfigDomainSpec, SERVER_NAME_PATTERN, type McpServerRecord } from './spec.ts'
import type { McpConfigErrorCode } from './types.ts'

/** Cordis plugin name. */
export const name = 'mcp-config'
/** Services required before activation. */
export const inject = ['webServer', 'storageDomain', 'tools']

const API_PREFIX = '/api/mcp'
// Bound on request bodies; env/header dicts for several servers fit far below it.
const MAX_BODY_BYTES = 64 * 1024
/** Bound on the stored roster. */
const MAX_SERVERS = 64
/** Default per-tool-call timeout, matching dsh-mcp-client. */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Deployment policy for the management surface. */
export interface Config {
  /** Non-loopback authorities admitted by the trust fence (the connection plugin's bare `host[:port]` vocabulary). */
  trustedHosts: string[]
  /**
   * Allow management from declared `trustedHosts` (in addition to loopback).
   * Default off: management is loopback-only, mirroring dsh-auth's key
   * management and dsh's own loopback-pinned privileged plane.
   */
  allowRemoteManage: boolean
}

/** Loader validation for {@link Config}. */
export const Config: z<Config> = z.object({
  trustedHosts: z.array(z.string()).default([]),
  allowRemoteManage: z.boolean().default(false),
})

/** Wire shape for adding one MCP server; zod for request-body validation. */
const mcpServerInputSchema = zod.discriminatedUnion('transport', [
  zod.object({
    transport: zod.literal('stdio'),
    serverName: zod.string().regex(SERVER_NAME_PATTERN),
    command: zod.string().min(1),
    args: zod.array(zod.string()).default([]),
    env: zod.record(zod.string(), zod.string()).default({}),
    cwd: zod.string().default(''),
    toolCallTimeoutMs: zod.number().int().positive().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  }),
  zod.object({
    transport: zod.literal('streamable-http'),
    serverName: zod.string().regex(SERVER_NAME_PATTERN),
    url: zod.string().min(1),
    headers: zod.record(zod.string(), zod.string()).default({}),
    toolCallTimeoutMs: zod.number().int().positive().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  }),
])

/**
 * Plugin body: open the roster domain, reconcile live mcp-client instances
 * against it, and mount the management routes.
 * @param ctx - Host plugin context carrying webServer and storageDomain.
 * @param config - resolved deployment policy (schema defaults applied).
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  for (const entry of config.trustedHosts) assertTrustedAuthority(entry)
  const domain = await ctx.storageDomain.open(mcpConfigDomainSpec)
  ctx.effect(() => async () => { await domain.close() }, 'mcp-config.domainClose')

  const errorBody = (code: McpConfigErrorCode): { error: { code: McpConfigErrorCode } } => ({ error: { code } })

  const roster = (): McpServerRecord[] => domain.global.get().servers

  /** Live mcp-client fibers, keyed by server id; disposal tears down the connection and tools. */
  const live = new Map<string, Fiber & PromiseLike<Fiber>>()
  /** Load/startup errors per server id, reported by the list endpoint. */
  const loadErrors = new Map<string, string>()

  const toMcpClientConfig = (server: McpServerRecord): McpClientConfig => {
    if (server.transport === 'stdio') {
      return {
        transport: 'stdio',
        serverName: server.serverName,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
        toolCallTimeoutMs: server.toolCallTimeoutMs,
        failOnStartupError: false,
      }
    }
    return {
      transport: 'streamable-http',
      serverName: server.serverName,
      url: server.url,
      headers: server.headers,
      toolCallTimeoutMs: server.toolCallTimeoutMs,
      failOnStartupError: false,
    }
  }

  const loadServer = (server: McpServerRecord): void => {
    loadErrors.delete(server.id)
    try {
      const fiber = ctx.plugin(McpClient, toMcpClientConfig(server))
      live.set(server.id, fiber)
      // A rejection names a load-time failure (invalid config, duplicate
      // serverName); connection failures with failOnStartupError=false enter
      // mcp-client's reconnect loop instead and settle the fiber normally.
      void fiber.then(
        () => {},
        (error: unknown) => {
          loadErrors.set(server.id, error instanceof Error ? error.message : String(error))
        },
      )
    } catch (error) {
      loadErrors.set(server.id, error instanceof Error ? error.message : String(error))
    }
  }

  /** Bring live instances in line with the roster: dispose removed, load added. */
  const reconcile = (): void => {
    const servers = roster()
    for (const [id, fiber] of [...live]) {
      if (!servers.some(server => server.id === id)) {
        fiber.dispose()
        live.delete(id)
        loadErrors.delete(id)
      }
    }
    for (const server of servers) {
      if (!live.has(server.id)) loadServer(server)
    }
  }

  reconcile()

  const admit = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isTrustedApiRequest(req, config.trustedHosts)) {
      sendJson(res, 403, errorBody('untrusted-request'))
      return false
    }
    if (!config.allowRemoteManage && !isLoopbackRequest(req)) {
      sendJson(res, 403, errorBody('loopback-only'))
      return false
    }
    return true
  }

  const readBodyObject = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (typeof body !== 'object' || body === null) return undefined
    return body as Record<string, unknown>
  }

  /** The server's live tool set, read from the global tool registry under its namespace. */
  const serverTools = (serverName: string): { name: string; description: string }[] => {
    const prefix = `mcp__${serverName}__`
    return ctx.tools.schemas()
      .filter(schema => schema.name.startsWith(prefix))
      .map(schema => ({ name: schema.name.slice(prefix.length), description: schema.description }))
  }

  const view = (server: McpServerRecord): Record<string, unknown> => {
    const tools = serverTools(server.serverName)
    return {
      ...server,
      loaded: live.has(server.id),
      error: loadErrors.get(server.id) ?? null,
      online: tools.length > 0,
      tools,
    }
  }

  const handleList = (req: IncomingMessage, res: ServerResponse): void => {
    if (!admit(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    sendJson(res, 200, { servers: roster().map(view) })
  }

  const handleAdd = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admit(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    const body = await readBodyObject(req)
    const parsed = mcpServerInputSchema.safeParse(body)
    if (!parsed.success) {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    const input = parsed.data
    const servers = roster()
    if (servers.length >= MAX_SERVERS) {
      sendJson(res, 400, errorBody('too-many-servers'))
      return
    }
    if (servers.some(server => server.serverName === input.serverName)) {
      sendJson(res, 409, errorBody('duplicate-server-name'))
      return
    }
    const base = {
      id: randomUUID(),
      serverName: input.serverName,
      toolCallTimeoutMs: input.toolCallTimeoutMs,
      createdAt: Date.now(),
    }
    const record: McpServerRecord = input.transport === 'stdio'
      ? { ...base, transport: 'stdio', command: input.command, args: input.args, env: input.env, cwd: input.cwd }
      : { ...base, transport: 'streamable-http', url: input.url, headers: input.headers }
    await domain.global.set({ servers: [...servers, record] })
    reconcile()
    sendJson(res, 200, { server: view(record) })
  }

  const handleUpdate = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admit(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    const body = await readBodyObject(req)
    const id = body?.id
    if (typeof id !== 'string') {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    const servers = roster()
    const existing = servers.find(server => server.id === id)
    if (existing === undefined) {
      sendJson(res, 404, errorBody('unknown-server'))
      return
    }
    const inputBody = { ...body }
    delete inputBody.id
    const parsed = mcpServerInputSchema.safeParse(inputBody)
    if (!parsed.success) {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    const input = parsed.data
    if (servers.some(server => server.id !== id && server.serverName === input.serverName)) {
      sendJson(res, 409, errorBody('duplicate-server-name'))
      return
    }
    const base = {
      id: existing.id,
      serverName: input.serverName,
      toolCallTimeoutMs: input.toolCallTimeoutMs,
      createdAt: existing.createdAt,
    }
    const record: McpServerRecord = input.transport === 'stdio'
      ? { ...base, transport: 'stdio', command: input.command, args: input.args, env: input.env, cwd: input.cwd }
      : { ...base, transport: 'streamable-http', url: input.url, headers: input.headers }
    await domain.global.set({ servers: servers.map(server => server.id === id ? record : server) })
    // A config change cannot mutate the live instance — dispose it and let
    // reconcile start a fresh one with the updated transport/serverName.
    const existingFiber = live.get(id)
    if (existingFiber !== undefined) {
      existingFiber.dispose()
      live.delete(id)
    }
    loadErrors.delete(id)
    reconcile()
    sendJson(res, 200, { server: view(record) })
  }

  const handleRemove = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!admit(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, errorBody('method-not-allowed'))
      return
    }
    const body = await readBodyObject(req)
    const id = body?.id
    if (typeof id !== 'string') {
      sendJson(res, 400, errorBody('invalid-request'))
      return
    }
    const servers = roster()
    if (!servers.some(server => server.id === id)) {
      sendJson(res, 404, errorBody('unknown-server'))
      return
    }
    await domain.global.set({ servers: servers.filter(server => server.id !== id) })
    reconcile()
    sendJson(res, 200, {})
  }

  const routes = [
    { path: `${API_PREFIX}/list`, handler: handleList },
    { path: `${API_PREFIX}/add`, handler: handleAdd },
    { path: `${API_PREFIX}/update`, handler: handleUpdate },
    { path: `${API_PREFIX}/remove`, handler: handleRemove },
  ]
  for (const route of routes) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }),
      `mcp-config: ${route.path} route`,
    )
  }

  // Model-facing query tool: lets the agent enumerate the configured MCP
  // servers, their connection status, and their registered tool names before
  // calling an mcp__* tool.
  ctx.effect(
    () => ctx.tools.register(defineTool({
      name: 'mcp_list',
      description: 'List every configured MCP server with its transport, connection status (online or not), and the tool names it exposes. Call this to see which MCP servers are available before using an mcp__<serverName>__<tool> tool.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async () => {
        const servers = roster().map((server) => {
          const tools = serverTools(server.serverName)
          return {
            serverName: server.serverName,
            transport: server.transport,
            online: tools.length > 0,
            error: loadErrors.get(server.id) ?? null,
            tools: tools.map(tool => tool.name),
          }
        })
        return { servers }
      },
    })),
    'mcp-config: mcp_list tool',
  )
}
