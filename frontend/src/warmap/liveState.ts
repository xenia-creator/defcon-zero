// What the live war map shows, worked out from the three public reads (lib/queries):
// GET /rounds/current (null = 404, no round yet), GET /standings (null = 404; nations [] = nothing
// published yet) and GET /territories. Pure, so every state is unit-tested.
import { ROUNDS, roundByNumber } from '../lib/rounds'
import type { MapNotice, RoundStatus } from './types'

/** The slice of a react-query result this needs. */
export interface Read {
  data: unknown
  isError: boolean
  isFetching: boolean
  /** When it last failed (0 = never). Survives a refetch, unlike isError. */
  errorUpdatedAt: number
}

export type Connection =
  /** First load still in flight, nothing yet. */
  | 'connecting'
  /** Cold start failed: a read has never succeeded. Full error screen with retry. */
  | 'fault'
  /** A poll failed, but the last good data is still there. Map plus "signal lost" badge. */
  | 'degraded'
  | 'ok'

export function connection(reads: Read[]): Connection {
  // 404s become null in lib/queries, so `undefined` is the only "never loaded".
  // A read with no data goes back to `pending` (isError false) on every refetch in react-query v5,
  // so "has failed and still has nothing" is read from errorUpdatedAt; otherwise the error screen
  // would flicker back to "connecting" on each 2 s poll and its Retry button would vanish.
  if (reads.some((r) => r.data === undefined && (r.isError || r.errorUpdatedAt > 0))) return 'fault'
  if (reads.some((r) => r.data === undefined)) return 'connecting'
  if (reads.some((r) => r.isError)) return 'degraded'
  return 'ok'
}

export interface LiveView {
  conn: Connection
  /** undefined while loading, null when no round has started. */
  round: { number: number; status: RoundStatus } | null | undefined
  /** How many nations have published results (GET /standings nations). */
  ranked: number
}

/** The plate over the map, or null when the board speaks for itself. */
export function liveNotice({ conn, round, ranked }: LiveView): MapNotice | null {
  if (conn === 'connecting') return { tone: 'standby', title: 'Establishing uplink', detail: 'Contacting command…' }
  if (round === undefined) return null
  if (round === null) {
    return { tone: 'standby', title: 'Standby · no round yet', detail: 'The first round has not started. Nations appear as teams claim them.' }
  }
  if (ranked > 0) return null
  switch (round.status) {
    case 'waiting':
      return { tone: 'standby', title: `Round ${round.number} standing by`, detail: 'The window has not opened yet. No results published.' }
    case 'open':
      return { tone: 'progress', title: 'Round in progress', detail: 'Submissions are open. Standings appear once results are published.' }
    case 'running':
      return { tone: 'progress', title: 'Round in progress', detail: 'Matches are being played. Standings appear once results are published.' }
    case 'review':
      return { tone: 'progress', title: 'Results under review', detail: 'Standings appear once the organisers publish them.' }
    case 'published':
      return null
  }
}

/**
 * What the public leaderboard shows. GET /standings only ever holds published results (api.md §6),
 * so the board never has live ranks to hide: it either shows the latest published standings or an
 * "awaiting results" panel.
 */
export type BoardState =
  | { kind: 'awaiting'; title: string; detail: string }
  | {
      kind: 'results'
      /** The latest published round, which the standings come from. */
      resultsRound: number
      /** The current round (GET /rounds/current), which may be newer and not yet published. */
      current: { number: number; status: RoundStatus }
    }

/**
 * The contract has no "which round are these from" field, so it is derived from the round order
 * rule (api.md §4: a round opens only once every lower round is published): if the current round
 * is published the standings are its results, otherwise they are the previous round's.
 */
export function boardState(round: LiveView['round'], ranked: number): BoardState {
  if (round === undefined) return { kind: 'awaiting', title: 'Awaiting signal', detail: 'Contacting command…' }
  if (round === null) {
    return { kind: 'awaiting', title: 'No round yet', detail: 'Standings appear here once the first round is published.' }
  }
  if (ranked === 0) {
    const detail =
      round.status === 'review'
        ? `Round ${round.number} is under review. Standings appear once the organisers publish them.`
        : round.status === 'waiting'
          ? `Round ${round.number} has not opened yet. No results published.`
          : `Round ${round.number} in progress. Standings appear once results are published.`
    return { kind: 'awaiting', title: 'Awaiting results', detail }
  }
  const resultsRound = round.status === 'published' ? round.number : Math.max(1, round.number - 1)
  return { kind: 'results', resultsRound, current: { number: round.number, status: round.status } }
}

const PENDING: Record<RoundStatus, string> = {
  waiting: 'standing by',
  open: 'in progress',
  running: 'in progress',
  review: 'under review',
  published: 'published',
}

/**
 * The board's heading, so the projector always says whose results these are:
 * "Round 1 · The Prisoner's Dilemma — Final", and while a newer round is under way,
 * "Round 2 in progress · results pending" beneath it. Round names come from lib/rounds.
 */
export function boardHeading(board: Extract<BoardState, { kind: 'results' }>): { title: string; sub: string | null } {
  const { resultsRound, current } = board
  const name = roundByNumber(resultsRound)?.name
  // Live, the shown round is always published. Only the scripted showcase ranks a round as it plays.
  const final = current.number > resultsRound || current.status === 'published'
  const title = `Round ${resultsRound}${name ? ` · ${name}` : ''} — ${final ? 'Final' : 'Provisional'}`
  if (current.number > resultsRound) return { title, sub: `Round ${current.number} ${PENDING[current.status]} · results pending` }
  if (final && current.number >= ROUNDS.length) return { title, sub: 'Tournament complete' }
  return { title, sub: null }
}
