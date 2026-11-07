// Scripted mini-event for the war map's SHOWCASE LOOP (never the live map). Territories and
// nations use the contract's shapes (lib/contract, docs/api.md v5.3); the troop movement
// stream at the end uses the showcase-only TroopMovement from types.ts.

import { COUNTRIES } from './worldPaths'
import type { MapRound, MapTerritory, RoundStatus, StandingsNation, TeamStatus, TroopMovement } from './types'

// The round the showcase pretends is on.
export const mockCurrentRound: MapRound = { number: 1, game: 'prisoners_dilemma', status: 'running' }
const MOCK_START_MS = Date.parse('2026-11-12T10:30:00Z')

/** One scripted poll: what GET /standings would have said, plus the server time it was sent at. */
export interface ShowcaseFrame {
  roundStatus: RoundStatus
  nations: StandingsNation[]
  serverTime: number // ms
}

const TEAMS = [
  { team_id: 7, nation_name: 'Red Dawn', territory_code: 'RU' },
  { team_id: 3, nation_name: 'Liberty Bloc', territory_code: 'US' },
  { team_id: 12, nation_name: 'Jade Dynasty', territory_code: 'CN' },
  { team_id: 5, nation_name: 'Amazon Pact', territory_code: 'BR' },
  { team_id: 9, nation_name: 'Southern Cross', territory_code: 'AU' },
  { team_id: 2, nation_name: 'Monsoon Union', territory_code: 'IN' },
  { team_id: 14, nation_name: 'Sahara Front', territory_code: 'DZ' },
  { team_id: 8, nation_name: 'Maple Accord', territory_code: 'CA' },
  { team_id: 11, nation_name: 'Iron Steppe', territory_code: 'KZ' },
  { team_id: 4, nation_name: 'Rising Sun', territory_code: 'JP' },
] as const

// GET /territories: claimed ones come from TEAMS, plus a few unclaimed.
export const mockTerritories: MapTerritory[] = [
  ...TEAMS.map((t) => ({
    territory_code: t.territory_code,
    name: COUNTRIES[t.territory_code]?.name ?? t.territory_code,
    claimed: true,
    nation_name: t.nation_name as string | null,
  })),
  ...['FR', 'DE', 'ZA', 'MX', 'AR', 'EG', 'NG', 'ID'].map((code) => ({
    territory_code: code,
    name: COUNTRIES[code]?.name ?? code,
    claimed: false,
    nation_name: null,
  })),
]

// One frame per poll: score and status per team_id. The script opens mid-round
// with scores already on the board, so the demo never shows a column of zeros. Rank is derived from
// score (eliminated and disqualified teams sink below active ones).
type Frame = Record<number, [score: number, status: TeamStatus]>

const FRAMES: Frame[] = [
  { 7: [610, 'active'], 3: [640, 'active'], 12: [590, 'active'], 5: [420, 'active'], 9: [500, 'active'], 2: [600, 'active'], 14: [380, 'active'], 8: [550, 'active'], 11: [450, 'active'], 4: [580, 'active'] },
  { 7: [1240, 'active'], 3: [1190, 'active'], 12: [1230, 'active'], 5: [760, 'active'], 9: [980, 'active'], 2: [1210, 'active'], 14: [640, 'eliminated'], 8: [1050, 'active'], 11: [870, 'active'], 4: [1150, 'active'] },
  { 7: [1820, 'active'], 3: [1880, 'active'], 12: [1790, 'active'], 5: [990, 'eliminated'], 9: [1460, 'active'], 2: [1850, 'active'], 14: [640, 'eliminated'], 8: [1500, 'active'], 11: [1240, 'active'], 4: [1610, 'active'] },
  { 7: [2400, 'active'], 3: [2380, 'active'], 12: [2450, 'active'], 5: [990, 'eliminated'], 9: [1900, 'active'], 2: [2320, 'active'], 14: [640, 'eliminated'], 8: [1930, 'active'], 11: [1240, 'disqualified'], 4: [2090, 'active'] },
  { 7: [2960, 'active'], 3: [3010, 'active'], 12: [2990, 'active'], 5: [990, 'eliminated'], 9: [2280, 'eliminated'], 2: [2870, 'active'], 14: [640, 'eliminated'], 8: [2300, 'eliminated'], 11: [1240, 'disqualified'], 4: [2640, 'active'] },
  { 7: [3120, 'active'], 3: [3480, 'active'], 12: [3550, 'active'], 5: [990, 'eliminated'], 9: [2280, 'eliminated'], 2: [3290, 'active'], 14: [640, 'eliminated'], 8: [2300, 'eliminated'], 11: [1240, 'disqualified'], 4: [2900, 'eliminated'] },
  { 7: [3910, 'active'], 3: [3870, 'eliminated'], 12: [4020, 'active'], 5: [990, 'eliminated'], 9: [2280, 'eliminated'], 2: [3760, 'eliminated'], 14: [640, 'eliminated'], 8: [2300, 'eliminated'], 11: [1240, 'disqualified'], 4: [2900, 'eliminated'] },
  { 7: [4600, 'active'], 3: [3870, 'eliminated'], 12: [4380, 'eliminated'], 5: [990, 'eliminated'], 9: [2280, 'eliminated'], 2: [3760, 'eliminated'], 14: [640, 'eliminated'], 8: [2300, 'eliminated'], 11: [1240, 'disqualified'], 4: [2900, 'eliminated'] },
]

const STATUS_ORDER: Record<TeamStatus, number> = { active: 0, eliminated: 1, disqualified: 2 }

function buildFrame(frame: Frame, index: number): ShowcaseFrame {
  const nations: StandingsNation[] = TEAMS.map((t) => {
    const [score, status] = frame[t.team_id]
    return { ...t, status, score, rank: 0 }
  })
  nations.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.score - a.score)
  nations.forEach((n, i) => (n.rank = i + 1))

  const last = index === FRAMES.length - 1
  return {
    roundStatus: last ? 'published' : 'running',
    nations,
    serverTime: MOCK_START_MS + index * 2000,
  }
}

// One scripted poll after another, in order.
export const mockStandingsSequence: ShowcaseFrame[] = FRAMES.map(buildFrame)

// Troop movements (provisional, see TroopMovement in types.ts).
// Who tends to strike whom, roughly by geography, keyed by team_id.
const RIVALS: Record<number, number[]> = {
  7: [11, 12, 4, 3, 8], // Red Dawn: Iron Steppe, Jade Dynasty, Rising Sun, Liberty Bloc, Maple Accord
  3: [8, 5, 7, 4], // Liberty Bloc
  12: [2, 11, 7, 4, 9], // Jade Dynasty
  5: [3, 14], // Amazon Pact
  9: [4, 12, 2], // Southern Cross
  2: [12, 11, 9, 14], // Monsoon Union
  14: [5, 2, 7], // Sahara Front
  8: [3, 7], // Maple Accord
  11: [7, 12, 2], // Iron Steppe
  4: [12, 7, 9, 3], // Rising Sun
}

// Small seeded PRNG so the script is identical on every run.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildMovements(index: number): TroopMovement[] {
  const rand = mulberry32(index * 7919 + 17)
  const frame = FRAMES[index]
  const next = FRAMES[index + 1]
  const isActive = (id: number) => frame[id][1] === 'active'
  const pollStart = mockStandingsSequence[index].serverTime
  const troops = (min: number, max: number) => Math.round((min + rand() * (max - min)) / 50) * 50
  const moves: { from: number; to: number; troops: number }[] = []

  // Nations about to fall (eliminated in the next poll) take a concentrated assault.
  const doomed = next
    ? Object.keys(frame).map(Number).filter((id) => isActive(id) && next[id][1] === 'eliminated')
    : []
  for (const target of doomed) {
    const attackers = Object.keys(RIVALS).map(Number)
      .filter((id) => isActive(id) && !doomed.includes(id) && RIVALS[id].includes(target))
    for (const from of attackers.slice(0, 3)) moves.push({ from, to: target, troops: troops(1200, 2600) })
  }

  // Background skirmishes so armies are always on the move.
  const sources = Object.keys(frame).map(Number).filter(isActive)
  const skirmishes = Math.min(sources.length - 1, 5 - Math.min(doomed.length, 2))
  for (let i = 0; i < skirmishes; i++) {
    const from = sources[Math.floor(rand() * sources.length)]
    const targets = RIVALS[from].filter(isActive)
    if (!targets.length) continue
    const to = targets[Math.floor(rand() * targets.length)]
    moves.push({ from, to, troops: troops(200, 1100) })
  }

  // Stagger launches across the poll window so they don't all fire at once.
  return moves.map((m, i) => ({
    id: `m${index}-${i}`,
    from_team_id: m.from,
    to_team_id: m.to,
    troops: m.troops,
    launched_at: new Date(pollStart + Math.round(((i + rand()) / moves.length) * 1800))
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
  }))
}

// One batch per standings poll, aligned with mockStandingsSequence by index.
export const mockMovementSequence: TroopMovement[][] = FRAMES.map((_, i) => buildMovements(i))
