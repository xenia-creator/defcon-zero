import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, request } from './api'
import { useAuth } from './auth'
import { syncClock } from './clock'
import { Round, SubmissionDetail, Submissions, Team, Territories } from './contract'

// docs/api.md: poll the round every 2 seconds, and every second while a submission is pending
const ROUND_POLL_MS = 2_000
const PENDING_POLL_MS = 1_000
const SUBMISSIONS_POLL_MS = 5_000
const TEAM_POLL_MS = 5_000
const TERRITORIES_POLL_MS = 3_000

const useLoggedIn = () => useAuth((s) => !!s.session)

export const useCurrentRound = () =>
  useQuery({
    queryKey: ['round', 'current'],
    enabled: useLoggedIn(),
    retry: false, // the next poll is the retry
    refetchInterval: ROUND_POLL_MS,
    staleTime: 0,
    queryFn: async () => {
      const sentAt = Date.now()
      try {
        const round = await request('GET', '/rounds/current', Round)
        syncClock(sentAt, round.serverTime, Date.now())
        return round
      } catch (err) {
        if (err instanceof ApiError && err.code === 'NOT_FOUND') return null // no round yet
        throw err
      }
    },
  })

export const useTeam = (enabled: boolean) =>
  useQuery({
    queryKey: ['team', 'me'],
    enabled,
    refetchInterval: TEAM_POLL_MS,
    staleTime: 0,
    queryFn: () => request('GET', '/teams/me', Team),
  })

export const useTerritories = () =>
  useQuery({
    queryKey: ['territories'],
    refetchInterval: TERRITORIES_POLL_MS,
    staleTime: 0,
    queryFn: () => request('GET', '/territories', Territories),
  })

export const useSubmissions = () =>
  useQuery({
    queryKey: ['submissions'],
    queryFn: () => request('GET', '/submissions', Submissions),
    refetchInterval: (query) => (query.state.data?.some((s) => s.status === 'pending') ? PENDING_POLL_MS : SUBMISSIONS_POLL_MS),
    staleTime: 0,
  })

/** One version's result. A finished one never changes, so it stops polling. */
export const useSubmission = (id: number | undefined) =>
  useQuery({
    queryKey: ['submission', id],
    enabled: id !== undefined,
    queryFn: () => request('GET', `/submissions/${id}`, SubmissionDetail),
    refetchInterval: (query) => (query.state.data && query.state.data.status !== 'pending' ? false : PENDING_POLL_MS),
    staleTime: (query) => (query.state.data && query.state.data.status !== 'pending' ? Infinity : 0),
  })

export const useBots = () =>
  useQuery({
    queryKey: ['bots'],
    queryFn: () => request('GET', '/practice/bots', z.array(z.object({ key: z.string(), description: z.string().default('') }))),
    staleTime: Infinity,
  })
