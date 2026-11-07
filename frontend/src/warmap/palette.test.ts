import { describe, expect, it } from 'vitest'
import { NEIGHBOURS, PALETTE, TERRITORY_CODES, familyOf, nationColour } from './palette'
import { COUNTRIES } from './worldPaths'

const palette: readonly string[] = PALETTE.map((p) => p.colour)

describe('nation palette', () => {
  it('covers the 42 territories, each drawn on the map', () => {
    expect(TERRITORY_CODES).toHaveLength(42)
    expect(new Set(TERRITORY_CODES).size).toBe(42)
    for (const code of TERRITORY_CODES) expect(COUNTRIES[code], code).toBeDefined()
  })

  it('only lists neighbours among the 42, with no pair twice', () => {
    const codes = new Set<string>(TERRITORY_CODES)
    const seen = new Set<string>()
    for (const [a, b] of NEIGHBOURS) {
      expect(codes.has(a) && codes.has(b), `${a}-${b}`).toBe(true)
      expect(a).not.toBe(b)
      const key = [a, b].sort().join('-')
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
  })

  it('gives every territory a palette colour', () => {
    for (const code of TERRITORY_CODES) expect(palette).toContain(nationColour(code))
  })

  it('never gives neighbours the same colour, or even the same hue family', () => {
    for (const [a, b] of NEIGHBOURS) {
      expect(nationColour(a), `${a}-${b}`).not.toBe(nationColour(b))
      expect(familyOf(nationColour(a)), `${a}-${b}`).not.toBe(familyOf(nationColour(b)))
    }
  })

  it('fixes the known clashes: AR/CL, and IN/PK/CN/KZ all apart', () => {
    expect(familyOf(nationColour('AR'))).not.toBe(familyOf(nationColour('CL')))
    const asia = ['IN', 'PK', 'CN', 'KZ'].map((c) => familyOf(nationColour(c)))
    expect(new Set(asia).size).toBe(4)
  })

  it('is fixed per code: the same every call, and an unknown code still gets a stable colour', () => {
    expect(nationColour('RU')).toBe(nationColour('RU'))
    expect(palette).toContain(nationColour('ZZ'))
    expect(nationColour('ZZ')).toBe(nationColour('ZZ'))
  })
})
