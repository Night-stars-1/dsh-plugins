/**
 * Access-key verification: a login candidate is accepted when it equals one
 * configured key or matches one stored page-key digest, compared through
 * SHA-256 digests in constant time so neither key length nor a partial-match
 * position leaks through timing. The match identifies which key succeeded so
 * the caller can record its last use; keys set through the pages are stored
 * only as digests, and plaintext keys exist only in deployment config.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

/** Minimum accepted key length; a shorter key is refused at load (config) or 400 (add-key). */
export const MIN_ACCESS_KEY_LENGTH = 8

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Digest one key for durable storage.
 * @param key - the key, verbatim.
 * @returns the SHA-256 hex digest.
 */
export function keyDigestHex(key: string): string {
  return digest(key).toString('hex')
}

/**
 * Assert one key is long enough to be usable.
 * @param key - the value, verbatim.
 */
export function assertAccessKey(key: string): void {
  if (key.length >= MIN_ACCESS_KEY_LENGTH) return
  throw new Error(`host-auth: an access key must be at least ${MIN_ACCESS_KEY_LENGTH} characters`)
}

/** Which key a login candidate matched. */
export type KeyMatch =
  | { kind: 'config'; digestHex: string }
  | { kind: 'page'; id: string }

/**
 * Match a login candidate against the configured keys and the stored
 * page-key digests.
 * @param candidate - the submitted key, verbatim.
 * @param accessKeys - the configured plaintext keys.
 * @param pageKeys - the stored page keys (id + SHA-256 hex digest).
 * @returns the matched key's identity, or undefined when nothing matched.
 */
export function matchKey(
  candidate: string,
  accessKeys: readonly string[],
  pageKeys: readonly { id: string; digestHex: string }[],
): KeyMatch | undefined {
  const submitted = digest(candidate)
  // Every key from both sources is compared so timing does not reveal which
  // (or whether an earlier) key matched.
  let match: KeyMatch | undefined
  for (const key of accessKeys) {
    const configured = digest(key)
    if (timingSafeEqual(configured, submitted)) {
      match = { kind: 'config', digestHex: configured.toString('hex') }
    }
  }
  for (const page of pageKeys) {
    const stored = Buffer.from(page.digestHex, 'hex')
    if (stored.length === submitted.length && timingSafeEqual(stored, submitted)) {
      match = { kind: 'page', id: page.id }
    }
  }
  return match
}
