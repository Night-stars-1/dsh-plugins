/** Closed error vocabulary of the /api/mcp endpoints. */
export type McpConfigErrorCode =
  | 'untrusted-request'
  | 'loopback-only'
  | 'method-not-allowed'
  | 'invalid-request'
  | 'invalid-server-name'
  | 'duplicate-server-name'
  | 'too-many-servers'
  | 'unknown-server'
