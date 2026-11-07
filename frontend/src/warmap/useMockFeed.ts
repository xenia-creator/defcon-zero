import { useEffect, useState } from 'react'
import { mockCurrentRound, mockMovementSequence, mockStandingsSequence, mockTerritories, type ShowcaseFrame } from './mock'
import type { MapRound, MapTerritory, TroopMovement } from './types'

const NO_MOVES: TroopMovement[] = []

export interface WarMapFeed {
  round: MapRound
  territories: MapTerritory[]
  frame: ShowcaseFrame
  // Showcase only: the backend sends no movement data (see TroopMovement in types.ts).
  movements: TroopMovement[]
  tick: number
}

// SHOWCASE LOOP ONLY. Never feeds the live map (LiveWarMap reads lib/queries).
// Steps through the scripted sequence every intervalMs, holds on the final frame, then loops.
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
    frame: mockStandingsSequence[index],
    // Quiet during the hold on the final frame.
    movements: step < mockMovementSequence.length ? mockMovementSequence[index] : NO_MOVES,
    tick,
  }
}
