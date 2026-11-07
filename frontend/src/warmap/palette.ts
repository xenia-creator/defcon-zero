// Nation colours on the war map: one fixed colour per territory code, chosen so that neighbouring
// nations never share a colour, or even a hue family (cyan and blue read alike on a projector).
// Colour depends only on the code and this file, never on who has claimed what, so a nation keeps
// the same colour from claim to ranked, in live and showcase alike.

/** The 10 nation colours, grouped into hue families that read alike from across a room. */
export const PALETTE = [
  { colour: '#00E5FF', family: 'blue' }, // cyan
  { colour: '#3D7BFF', family: 'blue' }, // electric blue
  { colour: '#20C95E', family: 'green' }, // green
  { colour: '#D4FF2B', family: 'green' }, // lime
  { colour: '#FFE53B', family: 'yellow' }, // gold
  { colour: '#F5A526', family: 'yellow' }, // amber
  { colour: '#FF6A1A', family: 'red' }, // orange
  { colour: '#E5253C', family: 'red' }, // red
  { colour: '#FF2BD6', family: 'purple' }, // magenta
  { colour: '#A855F7', family: 'purple' }, // violet
] as const

/**
 * The event's 42 territories (GET /territories; frontend/PLAN.md §7 N1). A code outside this list
 * still gets a fixed colour (hashed), just without the neighbour guarantee.
 */
export const TERRITORY_CODES = [
  'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'SE', 'NO', 'PL', 'GR', 'UA', 'RU', 'TR',
  'EG', 'DZ', 'MA', 'NG', 'KE', 'ZA', 'SA', 'IR', 'PK', 'IN', 'CN', 'JP', 'KR', 'KZ', 'ID', 'TH', 'VN', 'PH', 'AU', 'DK', 'FI',
] as const

/**
 * Which of the 42 sit next to each other on the map: land borders, plus close sea neighbours that
 * read as touching on the projector. Only pairs where both are in the list matter.
 */
export const NEIGHBOURS: ReadonlyArray<readonly [string, string]> = [
  // Americas
  ['US', 'CA'], ['US', 'MX'], ['BR', 'AR'], ['BR', 'CO'], ['BR', 'PE'], ['AR', 'CL'], ['CL', 'PE'], ['CO', 'PE'],
  // Europe
  ['FR', 'DE'], ['FR', 'ES'], ['FR', 'IT'], ['DE', 'NL'], ['DE', 'PL'], ['DE', 'DK'], ['SE', 'NO'], ['SE', 'FI'], ['NO', 'FI'],
  ['PL', 'UA'], ['PL', 'RU'], ['UA', 'RU'], ['NO', 'RU'], ['FI', 'RU'], ['GR', 'TR'],
  // Middle East, Africa, Asia
  ['DZ', 'MA'], ['TR', 'IR'], ['IR', 'PK'], ['PK', 'IN'], ['PK', 'CN'], ['IN', 'CN'], ['CN', 'KZ'], ['RU', 'KZ'], ['RU', 'CN'],
  ['CN', 'VN'],
  // Close across the water
  ['GB', 'FR'], ['GB', 'NL'], ['DK', 'SE'], ['DK', 'NO'], ['DE', 'SE'], ['ES', 'MA'], ['ES', 'DZ'], ['IT', 'GR'], ['UA', 'TR'],
  ['EG', 'SA'], ['SA', 'IR'], ['JP', 'KR'], ['CN', 'KR'], ['CN', 'JP'], ['RU', 'JP'], ['US', 'RU'], ['ID', 'AU'], ['ID', 'PH'],
  ['TH', 'VN'],
  // Not touching, but close enough in Central/South Asia to read as one block: keep all four apart.
  ['IN', 'KZ'], ['PK', 'KZ'],
]

/** FNV-1a of the code: where each code starts looking in the palette, and the colour of an unknown code. */
function hash(code: string) {
  let h = 0x811c9dc5
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h
}

/**
 * Greedy colouring, worked out once: most-connected codes first, each taking the first colour
 * (from its own hash offset) whose family no coloured neighbour has; failing that, any colour no
 * neighbour has. Fixed inputs, fixed order, so the result never changes between loads.
 */
function colourAll(): ReadonlyMap<string, string> {
  const adj = new Map<string, Set<string>>(TERRITORY_CODES.map((c) => [c, new Set()]))
  for (const [a, b] of NEIGHBOURS) {
    adj.get(a)?.add(b)
    adj.get(b)?.add(a)
  }
  const order = [...TERRITORY_CODES].sort((a, b) => adj.get(b)!.size - adj.get(a)!.size || (a < b ? -1 : 1))
  const picked = new Map<string, number>()
  for (const code of order) {
    const near = [...adj.get(code)!].flatMap((n) => (picked.has(n) ? [picked.get(n)!] : []))
    const families = new Set(near.map((i) => PALETTE[i].family))
    const start = hash(code) % PALETTE.length
    const tries = PALETTE.map((_, k) => (start + k) % PALETTE.length)
    const choice = tries.find((i) => !families.has(PALETTE[i].family)) ?? tries.find((i) => !near.includes(i)) ?? start
    picked.set(code, choice)
  }
  return new Map([...picked].map(([code, i]) => [code, PALETTE[i].colour]))
}

const COLOUR_BY_CODE = colourAll()

/** The nation colour for a territory code. Fixed per code; neighbours always differ. */
export function nationColour(code: string): string {
  return COLOUR_BY_CODE.get(code) ?? PALETTE[hash(code) % PALETTE.length].colour
}

/** The hue family of a palette colour (for tests and checks). */
export function familyOf(colour: string): string | undefined {
  return PALETTE.find((p) => p.colour === colour)?.family
}
