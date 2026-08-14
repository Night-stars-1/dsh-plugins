/**
 * Durable storage-domain declaration for access-key sessions: one `tokens`
 * table keyed by the SHA-256 digest of the bearer token, so a copied medium
 * never yields a usable session. No account data exists — admission is
 * decided against the configured access keys, and a token records its own
 * expiry plus which key kind granted it (a config-key session may manage
 * keys remotely; a page-key session may not).
 * @module @night-stars-1/dsh-host-auth/src/spec
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WebAuthTokenKey } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one live session-token record. */
export const webAccessTokenRecordSchema = z.object({
  expiresAt: nonNegativeSafeInteger,
  via: z.enum(['config', 'page']).optional(),
})

/** One live session token as stored on the medium. */
export type WebAccessTokenRecord = z.infer<typeof webAccessTokenRecordSchema>

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

/** Runtime schema for one page-managed key record (digest only, never plaintext). */
export const webAccessPageKeySchema = z.object({
  id: z.string().min(1),
  label: z.string().max(64),
  digestHex: sha256Hex,
  createdAt: nonNegativeSafeInteger,
  lastUsedAt: nonNegativeSafeInteger.nullable(),
})

/** One page-managed key as stored on the medium. */
export type WebAccessPageKey = z.infer<typeof webAccessPageKeySchema>

/**
 * Runtime schema for the page-managed key state: the key records plus a
 * digest-keyed last-use map for deployment-config keys (which have no stored
 * record of their own).
 */
export const webAccessKeyStateSchema = z.object({
  keys: z.array(webAccessPageKeySchema),
  configKeyUsage: z.record(sha256Hex, nonNegativeSafeInteger),
})

/** The page-managed key state as stored on the medium. */
export type WebAccessKeyState = z.infer<typeof webAccessKeyStateSchema>

/** The one access domain: live session tokens plus the page-managed key state. */
export const webAccessDomainSpec = defineDomain({
  name: 'web_access',
  version: 2,
  global: {
    schema: webAccessKeyStateSchema,
    initial: { keys: [], configKeyUsage: {} } satisfies WebAccessKeyState,
  },
  tables: {
    tokens: domainTable<WebAuthTokenKey, WebAccessTokenRecord>(
      webAccessTokenRecordSchema as unknown as z.ZodType<WebAccessTokenRecord>,
    ),
  },
})

/**
 * Brand the tokens-table key for one bearer token.
 * @param token - the cookie bearer token, verbatim.
 * @returns the SHA-256 hex digest key.
 */
export function tokenKey(token: string): WebAuthTokenKey {
  return createHash('sha256').update(token).digest('hex') as WebAuthTokenKey
}
