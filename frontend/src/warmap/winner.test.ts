import { describe, expect, it } from 'vitest'
import type { RoundStatus, StandingsNation, TeamStatus } from './types'
import { finalResult } from './winner'

const nation = (team_id: number, rank: number, status: TeamStatus = 'active', territory_code = `T${team_id}`): StandingsNation => ({
  team_id,
  nation_name: `Nation ${team_id}`,
  territory_code,
  status,
  score: 3000 - rank * 100,
  rank,
})

// The current round (GET /rounds/current); round ids follow numbers, as in the mock
const round = (number: number, status: RoundStatus) => ({ id: number, number, status })
const standings = (round_id: number, round_status: RoundStatus, nations: StandingsNation[]) => ({ round_id, round_status, nations })

// After the final cut: rank 1 and 2 active, everyone else eliminated earlier with their old round's rank
const winner = nation(7, 1, 'active', 'RU')
const runnerUp = nation(3, 2, 'active', 'BR')
const finalNations = [winner, runnerUp, nation(5, 3, 'eliminated'), nation(9, 9, 'eliminated'), nation(2, 16, 'eliminated')]

describe('finalResult', () => {
  it('is null with no round yet (GET /rounds/current and /standings both 404)', () => {
    expect(finalResult(null, null)).toBeNull()
    expect(finalResult(undefined, undefined)).toBeNull()
  })

  it('is null when Round 1 or Round 2 is published', () => {
    for (const n of [1, 2]) {
      expect(finalResult(round(n, 'published'), standings(n, 'published', finalNations))).toBeNull()
    }
  })

  it('is null while Round 3 is open, running or in review', () => {
    // Standings still hold the last published results (round 2) while round 3 is under way
    for (const status of ['waiting', 'open', 'running', 'review'] as const) {
      expect(finalResult(round(3, status), standings(3, status, finalNations))).toBeNull()
    }
  })

  it('gives the winner and the runner-up once Round 3 is published', () => {
    expect(finalResult(round(3, 'published'), standings(3, 'published', finalNations))).toEqual({ roundId: 3, winner, runnerUp })
  })

  it('is null when the standings are null or empty', () => {
    expect(finalResult(round(3, 'published'), null)).toBeNull()
    expect(finalResult(round(3, 'published'), undefined)).toBeNull()
    expect(finalResult(round(3, 'published'), standings(3, 'published', []))).toBeNull()
  })

  it('is null when the two reads disagree on the round (the polls race)', () => {
    // Round reads published before the standings poll has caught up: still round 2's results, 8 active
    const round2Results = Array.from({ length: 8 }, (_, i) => nation(i + 1, i + 1))
    expect(finalResult(round(3, 'published'), standings(2, 'published', round2Results))).toBeNull()
    // Same id, but the standings poll still says review
    expect(finalResult(round(3, 'published'), standings(3, 'review', round2Results))).toBeNull()
  })

  it('picks the active rank 1 when more than one row has rank 1', () => {
    const olderRankOne = nation(11, 1, 'disqualified', 'FR')
    const result = finalResult(round(3, 'published'), standings(3, 'published', [olderRankOne, winner, runnerUp]))
    expect(result?.winner).toBe(winner)
    expect(result?.runnerUp).toBe(runnerUp)
  })

  it('is null when rank 1 is no longer active, and never promotes the runner-up', () => {
    for (const status of ['disqualified', 'eliminated'] as const) {
      const fallen = { ...winner, status }
      expect(finalResult(round(3, 'published'), standings(3, 'published', [fallen, runnerUp, ...finalNations.slice(2)]))).toBeNull()
    }
  })

  it('gives the winner alone when there is no active rank 2', () => {
    const missing = finalResult(round(3, 'published'), standings(3, 'published', [winner, nation(5, 3, 'eliminated')]))
    expect(missing).toEqual({ roundId: 3, winner, runnerUp: null })
    const dq = finalResult(round(3, 'published'), standings(3, 'published', [winner, { ...runnerUp, status: 'disqualified' }]))
    expect(dq).toEqual({ roundId: 3, winner, runnerUp: null })
  })

  it('ignores eliminated and disqualified nations elsewhere in the list', () => {
    const crowded = [winner, runnerUp, nation(4, 3, 'disqualified'), nation(6, 2, 'eliminated'), nation(8, 1, 'eliminated'), nation(10, 20, 'eliminated')]
    expect(finalResult(round(3, 'published'), standings(3, 'published', crowded))).toEqual({ roundId: 3, winner, runnerUp })
  })
})
