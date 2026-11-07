// War map view types. Server shapes come from lib/contract (docs/api.md v5.3); nothing here
// re-declares them. Only TroopMovement is local, and it is showcase-only (not in the contract).
import type { GameKey } from '../lib/rounds'
import type { RoundStatus, StandingsNation, TeamStatus, TerritoryList } from '../lib/contract'

export type { RoundStatus, StandingsNation, TeamStatus }

/** One entry of GET /territories, as sent. */
export type MapTerritory = TerritoryList['territories'][number]

/** The part of the current round the map header shows. null on the live map before any round has started. */
export interface MapRound {
  number: number
  game: GameKey
  status: RoundStatus
}

/** A status plate over the live map: standby, round in progress, connecting. */
export interface MapNotice {
  tone: 'standby' | 'progress'
  title: string
  detail: string
}

// SHOWCASE ONLY. Not in docs/api.md: the backend sends no movement data, so the live map never
// receives this. The scripted showcase loop (mock.ts) generates it to drive TroopLayer's arcs.
// Nations are referenced by team_id so they join straight onto standings nations.
export interface TroopMovement {
  id: string
  from_team_id: number
  to_team_id: number
  troops: number
  launched_at: string // ISO 8601 UTC, compared against the frame's server time
}
