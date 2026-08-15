/**
 * Durable storage-domain declaration for the MCP server roster: one `global`
 * record holding the ordered server list. Each record is a discriminated
 * union mirroring dsh-mcp-client's two transport configs, plus an id and
 * creation time for stable referencing from the settings page.
 * @module @night-stars-1/dsh-mcp-config/src/spec
 */

import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'

/** Valid `serverName`, kept below the public tool-name budget (matches dsh-mcp-client). */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const stringDict = z.record(z.string(), z.string())

const stdioServerSchema = z.object({
  id: z.string().min(1),
  serverName: z.string().regex(SERVER_NAME_PATTERN),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: stringDict,
  cwd: z.string(),
  toolCallTimeoutMs: positiveSafeInteger,
  createdAt: nonNegativeSafeInteger,
})

const httpServerSchema = z.object({
  id: z.string().min(1),
  serverName: z.string().regex(SERVER_NAME_PATTERN),
  transport: z.literal('streamable-http'),
  url: z.string().min(1),
  headers: stringDict,
  toolCallTimeoutMs: positiveSafeInteger,
  createdAt: nonNegativeSafeInteger,
})

/** Runtime schema for one stored MCP server. */
export const mcpServerRecordSchema = z.discriminatedUnion('transport', [stdioServerSchema, httpServerSchema])

/** One stored MCP server, as held on the medium. */
export type McpServerRecord = z.infer<typeof mcpServerRecordSchema>

/** Runtime schema for the whole roster. */
export const mcpConfigStateSchema = z.object({
  servers: z.array(mcpServerRecordSchema),
})

/** The roster state as held on the medium. */
export type McpConfigState = z.infer<typeof mcpConfigStateSchema>

/** The one MCP-config domain. */
export const mcpConfigDomainSpec = defineDomain({
  name: 'mcp_config',
  version: 1,
  global: {
    schema: mcpConfigStateSchema,
    initial: { servers: [] } satisfies McpConfigState,
  },
  tables: {},
})
