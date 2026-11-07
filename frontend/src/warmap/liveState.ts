// What the live war map shows, worked out from the three public reads (lib/queries):
// GET /rounds/current (null = 404, no round yet), GET /standings (null = 404; nations [] = nothing
// published yet) and GET /territories. Pure, so every state is unit-tested.
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

/** The leaderboard's empty line. */
export function boardEmptyText(round: LiveView['round']): string {
  if (round === undefined) return 'Awaiting signal'
  if (round === null) return 'No round yet'
  return 'No published results yet'
}
