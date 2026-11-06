import { useCurrentRound } from '../lib/queries'
import type { GameKey, Round } from './types'
import { useMockFeed } from './useMockFeed'
import { WarMap } from './WarMap'

const GAME_BY_ROUND: Record<number, GameKey> = {
  1: 'prisoners_dilemma',
  2: 'theatre_of_war',
  3: 'foreign_aid',
}

// WarMap driven by the scripted mock feed, synced with the active round number/game when available.
export function WarMapPreview({ roundOverride }: { roundOverride?: 1 | 2 | 3 }) {
  const { round: mockRound, territories, standings, movements } = useMockFeed()
  const { data: liveRound } = useCurrentRound()

  const number = roundOverride ?? liveRound?.number ?? mockRound.number
  const game = GAME_BY_ROUND[number] ?? mockRound.game

  const round: Round = {
    ...mockRound,
    id: number,
    number,
    game,
  }

  return <WarMap round={round} territories={territories} standings={standings} movements={movements} />
}
