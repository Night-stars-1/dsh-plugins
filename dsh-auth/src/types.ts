/** Branded ids and wire types owned by the Web access plugin. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** SHA-256 digest of one bearer token, used as the tokens-table key so the medium never holds a usable token. */
export type WebAuthTokenKey = Branded<'WebAuthTokenKey'>

/** Closed error vocabulary of the /api/auth endpoints and the /api guard. */
export type WebAuthErrorCode =
  | 'untrusted-request'
  | 'method-not-allowed'
  | 'invalid-request'
  | 'invalid-credentials'
  | 'unauthenticated'
  | 'loopback-only'
  | 'weak-key'
  | 'duplicate-key'
  | 'unknown-key'
  | 'too-many-keys'
