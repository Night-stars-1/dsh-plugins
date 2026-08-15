/**
 * MCP-config behavior through the real HTTP surface: a live webserver + json
 * storage stack + the plugin, driven with fetch/raw sockets. The
 * dsh-mcp-client module is mocked (a real instance would spawn a process or
 * dial a URL), so the test asserts the roster and the mapping the plugin
 * hands to each live instance.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as McpConfig from '../src/index.ts'

const mocks = vi.hoisted(() => ({ mcpApply: vi.fn(async () => {}) }))

vi.mock('@deepseek-ai/dsh-mcp-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-mcp-client')>()
  return {
    ...actual,
    inject: [],
    apply: mocks.mcpApply,
  }
})

const BASE_CONFIG = {
  trustedHosts: [] as string[],
  allowRemoteManage: false,
}

let root: string
let ctx: Context

interface ToolSchemaStub {
  name: string
  description: string
  parameters: Record<string, unknown>
}

async function boot(
  config: Partial<typeof BASE_CONFIG> = {},
  tools: { schemas: () => ToolSchemaStub[]; register: () => () => void } = {
    schemas: () => [],
    register: () => () => {},
  },
): Promise<number> {
  ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('tools', tools)
  await ctx.plugin(McpConfig, { ...BASE_CONFIG, ...config })
  return ctx.get('webServer')!.port
}

interface JsonResponse {
  status: number
  body: unknown
}

async function callJson(
  port: number,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    redirect: 'manual',
  })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

/** Raw request with full header control (fetch refuses to override Host). */
function rawRequest(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
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
    request.end()
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-mcp-config-'))
  mocks.mcpApply.mockClear()
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('mcp-config roster', () => {
  it('lists empty, then adds (stdio and http) and removes, loading each as a live instance', async () => {
    const port = await boot()

    expect(await callJson(port, '/api/mcp/list')).toMatchObject({ status: 200, body: { servers: [] } })

    const stdio = await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: {
        transport: 'stdio',
        serverName: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'secret' },
        cwd: '/workspace',
      },
    })
    expect(stdio.status).toBe(200)
    expect(stdio.body).toMatchObject({
      server: { serverName: 'github', transport: 'stdio', loaded: true, error: null },
    })

    // The mapped config handed to the live mcp-client instance.
    expect(mocks.mcpApply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transport: 'stdio', serverName: 'github', command: 'npx' }),
    )

    const http = await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: {
        transport: 'streamable-http',
        serverName: 'web',
        url: 'http://localhost:3000/mcp',
        headers: { Authorization: 'Bearer tok' },
      },
    })
    expect(http.status).toBe(200)
    expect(http.body).toMatchObject({ server: { serverName: 'web', transport: 'streamable-http' } })

    const updated = await callJson(port, '/api/mcp/update', {
      method: 'POST',
      body: {
        id: (http.body as { server: { id: string } }).server.id,
        transport: 'streamable-http',
        serverName: 'web-renamed',
        url: 'http://localhost:4000/mcp',
        headers: {},
      },
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ server: { serverName: 'web-renamed', url: 'http://localhost:4000/mcp' } })

    const listed = await callJson(port, '/api/mcp/list')
    expect((listed.body as { servers: unknown[] }).servers).toHaveLength(2)

    const removed = await callJson(port, '/api/mcp/remove', {
      method: 'POST',
      body: { id: (stdio.body as { server: { id: string } }).server.id },
    })
    expect(removed.status).toBe(200)
    expect((await callJson(port, '/api/mcp/list')).body).toMatchObject({ servers: [{ serverName: 'web-renamed' }] })
  })

  it('persists the roster across a restart', async () => {
    const port = await boot()
    await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'gh', command: 'npx', args: [], env: {}, cwd: '' },
    })
    await ctx.fiber.dispose()

    const reopened = await boot()
    const listed = await callJson(reopened, '/api/mcp/list')
    expect((listed.body as { servers: unknown[] }).servers).toHaveLength(1)
    expect(listed.body).toMatchObject({ servers: [{ serverName: 'gh' }] })
  })

  it('reports online status and the live tool set from the registry', async () => {
    const schemas: ToolSchemaStub[] = [
      { name: 'mcp__github__create_issue', description: 'Create a GitHub issue', parameters: {} },
      { name: 'mcp__github__list_repos', description: 'List repositories', parameters: {} },
      { name: 'mcp__other__unrelated', description: 'another server', parameters: {} },
    ]
    const port = await boot({}, { schemas: () => schemas, register: () => () => {} })

    await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'github', command: 'npx' },
    })

    const listed = await callJson(port, '/api/mcp/list')
    const server = (listed.body as { servers: { online: boolean; tools: { name: string }[] }[] }).servers[0]
    expect(server).toBeDefined()
    expect(server.online).toBe(true)
    expect(server.tools.map(tool => tool.name)).toEqual(['create_issue', 'list_repos'])
  })

  it('updates an existing server and reloads the live instance', async () => {
    const port = await boot()
    const added = await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'gh', command: 'npx' },
    })
    const id = (added.body as { server: { id: string } }).server.id
    const callsBefore = mocks.mcpApply.mock.calls.length

    const updated = await callJson(port, '/api/mcp/update', {
      method: 'POST',
      body: { id, transport: 'stdio', serverName: 'gh2', command: 'node', args: ['x'], env: {}, cwd: '' },
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ server: { serverName: 'gh2', command: 'node' } })

    // The old live instance was disposed and a fresh one started.
    expect(mocks.mcpApply.mock.calls.length).toBe(callsBefore + 1)

    const listed = await callJson(port, '/api/mcp/list')
    expect(listed.body).toMatchObject({ servers: [{ serverName: 'gh2' }] })
  })

  it('validates input and refuses duplicate serverName', async () => {
    const port = await boot()

    const badName = await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'bad name!', command: 'x' },
    })
    expect(badName).toMatchObject({ status: 400, body: { error: { code: 'invalid-request' } } })

    const missingCommand = await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'ok' },
    })
    expect(missingCommand.status).toBe(400)

    await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'dup', command: 'x' },
    })
    const dup = await callJson(port, '/api/mcp/add', {
      method: 'POST',
      body: { transport: 'stdio', serverName: 'dup', command: 'x' },
    })
    expect(dup).toMatchObject({ status: 409, body: { error: { code: 'duplicate-server-name' } } })

    const unknown = await callJson(port, '/api/mcp/remove', { method: 'POST', body: { id: 'nope' } })
    expect(unknown).toMatchObject({ status: 404, body: { error: { code: 'unknown-server' } } })
  })
})

describe('mcp-config trust fence', () => {
  it('refuses non-loopback management by default and admits it with allowRemoteManage', async () => {
    const port = await boot({ trustedHosts: ['harness.internal'], allowRemoteManage: false })
    const remote = await rawRequest(port, '/api/mcp/list', { headers: { host: 'harness.internal:9999' } })
    expect(remote.status).toBe(403)
    expect(remote.body).toContain('loopback-only')
    await ctx.fiber.dispose()

    const reopened = await boot({ trustedHosts: ['harness.internal'], allowRemoteManage: true })
    const admitted = await rawRequest(reopened, '/api/mcp/list', { headers: { host: 'harness.internal:9999' } })
    expect(admitted.status).toBe(200)
  })

  it('refuses a rebound Host', async () => {
    const port = await boot()
    const rebound = await rawRequest(port, '/api/mcp/list', { headers: { host: 'evil.example' } })
    expect(rebound.status).toBe(403)
    expect(rebound.body).toContain('untrusted-request')
  })
})
