// The tournament's final result, for the winner reveal and the permanent winner banner.
// Pure, from the two public reads only (GET /rounds/current and GET /standings), so every state is unit-tested.
import { ROUNDS } from '../lib/rounds'
import type { RoundStatus, StandingsNation } from './types'

/** The last round. Its published rank 1 is the winner and rank 2 the runner-up (api.md §4, publish). */
const FINAL_ROUND = ROUNDS.length

export interface FinalResult {
  /** The current round's id, so the reveal plays once per final (dz.winner.<id>). */
  roundId: number
  winner: StandingsNation
  /** null when there is no active rank 2. */
  runnerUp: StandingsNation | null
}

/**
 * The winner and runner-up once the final round is published, or null. Never invents a winner:
 * - only when the final round is published, by both reads, and both reads name the same round
 *   (the two polls run apart, so the round can read `published` while the standings are still the
 *   previous round's results, whose rank 1 is not the winner);
 * - ranks repeat across rounds (api.md §6: each nation keeps its latest round's rank), so a rank is
 *   only trusted on an `active` nation: after the final cut only the top two are still active;
 * - a rank 1 that is no longer active (disqualified after publish) gives null. The runner-up is
 *   never promoted; that is the organisers' call, not the map's.
 */
export function finalResult(
  round: { id: number; number: number; status: RoundStatus } | null | undefined,
  standings: { round_id: number; round_status: RoundStatus; nations: readonly StandingsNation[] } | null | undefined,
): FinalResult | null {
  if (!round || round.number < FINAL_ROUND || round.status !== 'published') return null
  if (!standings || standings.round_status !== 'published' || standings.round_id !== round.id) return null
  const ranked = (rank: number) => standings.nations.filter((n) => n.rank === rank)
  // Several rank 1 rows: the active one is the final's (the rest are older rounds' results).
  // None active: the winner has fallen since publish, so there is no winner to show.
  const winner = ranked(1).find((n) => n.status === 'active')
  if (!winner) return null
  const runnerUp = ranked(2).find((n) => n.status === 'active') ?? null
  return { roundId: round.id, winner, runnerUp }
}
