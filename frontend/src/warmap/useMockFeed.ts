import { useEffect, useState } from 'react'
import { mockCurrentRound, mockMovementSequence, mockStandingsSequence, mockTerritories } from './mock'
import type { Round, StandingsResponse, TerritoriesResponse, TroopMovement } from './types'

const NO_MOVES: TroopMovement[] = []

export interface WarMapFeed {
  round: Round
  territories: TerritoriesResponse
  standings: StandingsResponse
  // Provisional: will come from standings.movements once the backend adds it.
  movements: TroopMovement[]
  tick: number
}

// Stands in for polling GET /standings every intervalMs. Steps through the
// scripted sequence, holds on the final frame, then loops.
export function useMockFeed(intervalMs = 2500, holdFrames = 3): WarMapFeed {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  const cycle = mockStandingsSequence.length + holdFrames
  const step = tick % cycle
  const index = Math.min(step, mockStandingsSequence.length - 1)

  return {
    round: mockCurrentRound,
    territories: mockTerritories,
    standings: mockStandingsSequence[index],
    // Quiet during the hold on the final frame.
    movements: step < mockMovementSequence.length ? mockMovementSequence[index] : NO_MOVES,
    tick,
  }
}
