/**
 * Round 2, Theatre of War (Colonel Blotto), played on the map: the team splits its
 * troops across the round's regions, and that split becomes a fixed strategy
 * returning the same list every turn. Kept apart from the screen so it can be tested.
 */
import { COUNTRIES, MAP_WIDTH, projectX, projectY } from '../../warmap/worldPaths'

export interface Front {
  name: string
  /** Where the label and troop count sit, as longitude and latitude. */
  label: [number, number]
  colour: string
}

/**
 * The five named fronts, in the fixed order the strategy's list uses:
 * the first number is Americas, the second Europe, and so on.
 */
export const FRONTS: readonly Front[] = [
  { name: 'Americas', label: [-88, 12], colour: '#3D7BFF' },
  { name: 'Europe', label: [16, 52], colour: '#F5A526' },
  { name: 'Africa & Middle East', label: [22, 4], colour: '#20C95E' },
  { name: 'Asia', label: [96, 44], colour: '#E5253C' },
  { name: 'Oceania', label: [138, -26], colour: '#00E5FF' },
]

const lonOf = (x: number) => (x / MAP_WIDTH) * 360 - 180
// Map y grows southwards, so "north of a latitude" is a smaller y
const northOf = (y: number, lat: number) => y < projectY(lat)

/** Which front a country belongs to, by where its main landmass sits. */
export function frontOf([x, y]: [number, number]): number {
  const lon = lonOf(x)
  if (lon < -25) return 0 // Americas, Greenland included
  if ((lon >= 112 && !northOf(y, -8)) || lon >= 150) return 4 // Oceania
  if (lon < 60 && northOf(y, 36)) return 1 // Europe, with Turkey and the Caucasus
  if (lon < 63) return 2 // Africa & Middle East
  return 3 // Asia
}

/** Every country on the map, grouped by front. Computed once. */
export const COUNTRY_FRONT: ReadonlyMap<string, number> = new Map(
  Object.entries(COUNTRIES).map(([code, shape]) => [code, frontOf(shape.anchor)]),
)

export const labelPoint = (front: Front): [number, number] => [projectX(front.label[0]), projectY(front.label[1])]

/** Region names for this round: the named fronts when the round has five regions, numbered ones otherwise. */
export const regionNames = (regions: number): string[] =>
  regions === FRONTS.length ? FRONTS.map((f) => f.name) : Array.from({ length: regions }, (_, i) => `Region ${i + 1}`)

/** What stops an allocation from being sent. Empty when it is valid. */
export function allocationProblems(allocation: readonly number[], troops: number, regions: number): string[] {
  const problems: string[] = []
  if (allocation.length !== regions) problems.push(`Place troops in exactly ${regions} regions.`)
  if (allocation.some((n) => !Number.isInteger(n))) problems.push('Troops must be whole numbers.')
  if (allocation.some((n) => n < 0)) problems.push('No region can have fewer than 0 troops.')
  const placed = allocation.reduce((sum, n) => sum + n, 0)
  if (placed !== troops) problems.push(placed < troops ? `Place ${troops - placed} more troops: all ${troops} must be placed.` : `Remove ${placed - troops} troops: only ${troops} can be placed.`)
  return problems
}

/** The fixed strategy that plays this allocation every turn, regions in the fixed order above. */
export function allocationCode(allocation: readonly number[], names: readonly string[]): string {
  const order = names.map((name, i) => `#   ${i + 1}. ${name}: ${allocation[i] ?? 0}`).join('\n')
  return `# Placed on the war map. The same split plays every turn, regions in this order:
${order}


def strategy(my_history, opp_history):
    return [${allocation.join(', ')}]
`
}

/**
 * The allocation in a strategy made by allocationCode, so a map version can open back on the map.
 * Anything else (hand-written or adaptive code) gives null and opens in the code editor.
 */
export function parseAllocation(code: string, regions: number): number[] | null {
  const body = code.replace(/^\s*#.*$/gm, '').trim()
  const match = body.match(/^def strategy\(my_history, opp_history\):\s*\n\s+return \[([\d,\s]*)\]\s*$/)
  if (!match) return null
  const numbers = match[1].split(',').map((n) => n.trim()).filter(Boolean).map(Number)
  return numbers.length === regions && numbers.every(Number.isInteger) ? numbers : null
}

/** An even split, with any remainder on the first regions. */
export const evenAllocation = (troops: number, regions: number): number[] =>
  Array.from({ length: regions }, (_, i) => Math.floor(troops / regions) + (i < troops % regions ? 1 : 0))
