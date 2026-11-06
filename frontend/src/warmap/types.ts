// Response shapes from docs/api.md (draft v2). Keep in sync with the contract.

export type TeamStatus = 'active' | 'eliminated' | 'disqualified'

export type RoundStatus = 'waiting' | 'open' | 'running' | 'review' | 'published'

export type GameKey = 'prisoners_dilemma' | 'theatre_of_war' | 'foreign_aid'

// GET /standings
export interface StandingsNation {
  team_id: number
  nation_name: string
  territory_code: string // ISO 3166-1 alpha-2
  status: TeamStatus
  score: number
  rank: number
}

export interface StandingsResponse {
  round_id: number
  round_status: RoundStatus
  nations: StandingsNation[]
  server_time: string
}

// GET /territories
export interface Territory {
  territory_code: string
  claimed: boolean
  nation_name: string | null
}

export interface TerritoriesResponse {
  territories: Territory[]
}

// GET /rounds/current
export interface RoundConfig {
  moves: string[] // [] in rounds 2 and 3, which play numbers
  max_modules: number
  block_limit: number
  rounds_per_match: number
  repetitions: number
  troops?: number // round 2
  regions?: number // round 2
  endowment?: number // round 3
  multiplier?: number // round 3
}

export interface Round {
  id: number
  number: number
  game: GameKey
  status: RoundStatus
  opens_at: string
  closes_at: string
  config: RoundConfig
  server_time: string
}

// PROVISIONAL, not in docs/api.md yet. Troop movements for Theatre of War.
// Expected to arrive as an optional `movements` array on GET /standings once the
// backend adds it; until then the mock feed supplies one batch per poll.
// Nations are referenced by team_id so they join straight onto standings.nations.
export interface TroopMovement {
  id: string
  from_team_id: number
  to_team_id: number
  troops: number
  launched_at: string // ISO 8601 UTC, compared against standings.server_time
}
