import { describe, expect, it } from 'vitest'
import { BLOCKS_MAX_BYTES, CODE_MAX_BYTES } from '../../lib/contract'
import { MAX_BLOCKS_BYTES, MAX_CODE_LENGTH, blocksBytes, utf8Bytes } from './drafts'

describe('workspace byte-size limits (docs/api.md section 5)', () => {
  it('aligns MAX_CODE_LENGTH and MAX_BLOCKS_BYTES with the contract constants', () => {
    expect(MAX_CODE_LENGTH).toBe(CODE_MAX_BYTES)
    expect(MAX_CODE_LENGTH).toBe(65_536)
    expect(MAX_BLOCKS_BYTES).toBe(BLOCKS_MAX_BYTES)
    expect(MAX_BLOCKS_BYTES).toBe(262_144)
  })

  it('measures code and block modules in UTF-8 bytes rather than character length', () => {
    // 1 emoji = 2 UTF-16 code units (.length === 2), 4 UTF-8 bytes
    expect('🚀'.length).toBe(2)
    expect(utf8Bytes('🚀')).toBe(4)
    expect(blocksBytes([])).toBe(utf8Bytes('{"modules":[]}'))
  })
})

