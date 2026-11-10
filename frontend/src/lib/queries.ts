/**
 * Every read the app makes, as react-query hooks, plus the organiser's actions.
 * Screens use these instead of calling the server themselves, so polling, the
 * "no round yet" 404 and who-may-call-what are decided once, here.
 *
 *   public (anyone, spectator included)   useCurrentRound, useStandings, useTerritories, useTerritoryList
 *   logged in (team or organiser)         useRounds
 *   team                                  useTeam, useSubmissions, useSubmission
 *   organiser                             useAdminOverview, admin.*
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError, request } from './api'
import { isSpectator, useAuth } from './auth'
import { syncClock } from './clock'
import {
  AdminOverview,
  Me,
  Round,
  Rounds,
  Standings,
  SubmissionDetail,
  Submissions,
  Team,
  Territories,
  TerritoryList,
  isChecked,
  type TeamStatus,
} from './contract'

// docs/api.md: the war map polls standings every 2 seconds; a pending submission every 1 to 2 seconds
const ROUND_POLL_MS = 2_000
const STANDINGS_POLL_MS = 2_000
const OVERVIEW_POLL_MS = 2_000
const PENDING_POLL_MS = 1_000
const SUBMISSIONS_POLL_MS = 5_000
const ROUNDS_POLL_MS = 5_000
const TEAM_POLL_MS = 5_000
const TERRITORIES_POLL_MS = 3_000

/** Query keys, so invalidation after an action reaches every screen that shows the data. */
export const keys = {
  currentRound: ['round', 'current'] as const,
  rounds: ['rounds'] as const,
  me: ['team', 'me'] as const,
  territories: ['territories'] as const,
  standings: ['standings'] as const,
  overview: ['admin', 'overview'] as const,
  submissions: (roundId?: number) => ['submissions', roundId] as const,
  submission: (id?: number) => ['submission', id] as const,
}

/** Signed in for real (a team or an organiser). A spectator has no token. */
const useSignedIn = () => useAuth((s) => !!s.session && !isSpectator(s.session))
const useIsOrganiser = () => useAuth((s) => s.session?.role === 'organiser')

/** A 404 here means "nothing yet" (no round started), not a failure. */
async function orNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') return null
    throw err
  }
}

/**
 * GET /rounds/current (public since v5.3, so a spectator calls it too, with no token).
 * null before any round has started (404). Never carries scores.
 */
export const useCurrentRound = () =>
  useQuery({
    queryKey: keys.currentRound,
    retry: false, // the next poll is the retry
    refetchInterval: ROUND_POLL_MS,
    staleTime: 0,
    queryFn: () =>
      orNull(async () => {
        const sentAt = Date.now()
        const round = await request('GET', '/rounds/current', Round)
        syncClock(sentAt, round.serverTime, Date.now())
        return round
      }),
  })

/** GET /rounds: every round, so the organiser can open the next waiting one. */
export const useRounds = () =>
  useQuery({
    queryKey: keys.rounds,
    enabled: useSignedIn(),
    refetchInterval: ROUNDS_POLL_MS,
    staleTime: 0,
    queryFn: async () => (await request('GET', '/rounds', Rounds)).rounds,
  })

/** GET /me, for a team keeping its status in sync. */
export const useTeam = (enabled: boolean) =>
  useQuery({
    queryKey: keys.me,
    enabled: useSignedIn() && enabled,
    refetchInterval: TEAM_POLL_MS,
    staleTime: 0,
    queryFn: () => request('GET', '/me', Team),
  })

/** GET /territories (public), for the claim screen: { code, name, claimed, nationName }, sorted by name. */
export const useTerritories = () =>
  useQuery({
    queryKey: keys.territories,
    refetchInterval: TERRITORIES_POLL_MS,
    staleTime: 0,
    queryFn: () => request('GET', '/territories', Territories),
  })

/** GET /territories (public), as sent: for the war map. Shares nothing with useTerritories' cache entry. */
export const useTerritoryList = () =>
  useQuery({
    queryKey: [...keys.territories, 'raw'],
    refetchInterval: TERRITORIES_POLL_MS,
    staleTime: 0,
    queryFn: () => request('GET', '/territories', TerritoryList),
  })

/**
 * GET /standings (public). Published results only. null means no round has started yet (404);
 * `nations: []` means nothing has been published yet. While a round runs or is in review it keeps
 * the last published results.
 */
export const useStandings = () =>
  useQuery({
    queryKey: keys.standings,
    refetchInterval: STANDINGS_POLL_MS,
    staleTime: 0,
    retry: false,
    queryFn: () => orNull(() => request('GET', '/standings', Standings)),
  })

/** This round's versions, newest first. */
export const useSubmissions = (roundId: number | undefined) =>
  useQuery({
    queryKey: keys.submissions(roundId),
    enabled: roundId !== undefined,
    queryFn: () => request('GET', `/submissions?round_id=${roundId}`, Submissions),
    refetchInterval: (query) => (query.state.data?.some((s) => !isChecked(s.status)) ? PENDING_POLL_MS : SUBMISSIONS_POLL_MS),
    staleTime: 0,
  })

/** One version's result. A checked one never changes, so it stops polling. */
export const useSubmission = (id: number | undefined) =>
  useQuery({
    queryKey: keys.submission(id),
    enabled: id !== undefined,
    queryFn: () => request('GET', `/submissions/${id}`, SubmissionDetail),
    refetchInterval: (query) => (query.state.data && isChecked(query.state.data.status) ? false : PENDING_POLL_MS),
    staleTime: (query) => (query.state.data && isChecked(query.state.data.status) ? Infinity : 0),
  })

/** GET /admin/overview (organiser only). Scores in every round state. null only if no rounds exist at all. */
export const useAdminOverview = () =>
  useQuery({
    queryKey: keys.overview,
    enabled: useIsOrganiser(),
    refetchInterval: OVERVIEW_POLL_MS,
    staleTime: 0,
    retry: false,
    queryFn: () => orNull(() => request('GET', '/admin/overview', AdminOverview)),
  })

/**
 * The organiser's actions (docs/api.md sections 4 and 7). Each returns the server's answer and
 * throws an ApiError, e.g. INVALID_ROUND_TRANSITION (409) or VALIDATION_ERROR (400, minutes outside 1 to 240, or a cut
 * the neighbouring rounds don't allow).
 * Call refreshAfterAdmin afterwards so every screen catches up.
 */
export const admin = {
  open: (roundId: number, minutes: number) => request('POST', `/admin/rounds/${roundId}/open`, Round, { minutes }),
  extend: (roundId: number, minutes: number) => request('POST', `/admin/rounds/${roundId}/extend`, Round, { minutes }),
  /** v5.5: close the window `minutes` from now, shorter or longer than it was. */
  setTime: (roundId: number, minutes: number) => request('POST', `/admin/rounds/${roundId}/set-time`, Round, { minutes }),
  /** v5.5: how many teams the round keeps at publish. Refused once published (409) and for the final round (400). */
  setCut: (roundId: number, cut: number) => request('PATCH', `/admin/rounds/${roundId}`, Round, { cut }),
  start: (roundId: number) => request('POST', `/admin/rounds/${roundId}/start`, Round),
  retry: (roundId: number) => request('POST', `/admin/rounds/${roundId}/retry`, Round),
  publish: (roundId: number) => request('POST', `/admin/rounds/${roundId}/publish`, Round),
  setTeamStatus: (teamId: number, status: TeamStatus) => request('PATCH', `/admin/teams/${teamId}`, Me, { status }),
}

/** Everything an organiser action can change. */
export function refreshAfterAdmin(queries: QueryClient) {
  return Promise.all(
    [keys.currentRound, keys.rounds, keys.standings, keys.overview, keys.territories, keys.me].map((queryKey) => queries.invalidateQueries({ queryKey })),
  )
}

export function useRefreshAfterAdmin() {
  const queries = useQueryClient()
  return useCallback(() => refreshAfterAdmin(queries), [queries])
}
