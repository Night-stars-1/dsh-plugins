/** Access-key matching behavior. */

import { describe, expect, it } from 'vitest'
import { assertAccessKey, keyDigestHex, matchKey } from '../src/access-key.ts'

describe('matchKey', () => {
  it('identifies which configured or page key a candidate matched', () => {
    const configKeys = ['first-key-abc', 'second-key-def']
    const pageKeys = [{ id: 'page-1', digestHex: keyDigestHex('page-key-xyz') }]

    expect(matchKey('first-key-abc', configKeys, pageKeys))
      .toEqual({ kind: 'config', digestHex: keyDigestHex('first-key-abc') })
    expect(matchKey('second-key-def', configKeys, pageKeys))
      .toEqual({ kind: 'config', digestHex: keyDigestHex('second-key-def') })
    expect(matchKey('page-key-xyz', configKeys, pageKeys)).toEqual({ kind: 'page', id: 'page-1' })

    expect(matchKey('first-key-ab', configKeys, pageKeys)).toBeUndefined()
    expect(matchKey('first-key-abc ', configKeys, pageKeys)).toBeUndefined()
    expect(matchKey('', configKeys, pageKeys)).toBeUndefined()
    expect(matchKey('first-key-abc', [], [])).toBeUndefined()
  })
})

describe('assertAccessKey', () => {
  it('accepts 8+ characters and refuses shorter keys', () => {
    expect(() => { assertAccessKey('12345678') }).not.toThrow()
    expect(() => { assertAccessKey('1234567') }).toThrow(/at least 8 characters/)
  })
})
