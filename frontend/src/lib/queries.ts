import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from './api'
import { useAuth } from './auth'
import { useConnection } from './realtime'

const POLL_MS = 5_000

const useLoggedIn = () => useAuth((s) => !!s.session)
/** Polling takes over whenever the WebSocket is down, so the timer and results never go stale. */
const usePollWhenOffline = () => useConnection((s) => (s.status === 'connected' ? false : POLL_MS))

export const useCurrentRound = () => {
  const offlinePoll = usePollWhenOffline()
  return useQuery({
    queryKey: ['round', 'current'],
    enabled: useLoggedIn(),
    // A failed load must not leave the screen saying "closed" while the window is open
    refetchInterval: (query) => (query.state.status === 'error' ? POLL_MS : offlinePoll),
    queryFn: async () => unwrap(await api.GET('/api/v1/rounds/current')),
  })
}

export const useCountries = () =>
  useQuery({ queryKey: ['countries'], queryFn: async () => unwrap(await api.GET('/api/v1/countries')) })

export const useSubmissions = () => {
  const offlinePoll = usePollWhenOffline()
  return useQuery({
    queryKey: ['submissions'],
    queryFn: async () => unwrap(await api.GET('/api/v1/submissions')),
    refetchInterval: (query) => (query.state.data?.some((s) => s.status === 'checking') ? POLL_MS : offlinePoll),
  })
}

export const useClientConfig = (enabled: boolean) =>
  useQuery({
    queryKey: ['config'],
    enabled,
    queryFn: async () => unwrap(await api.GET('/api/v1/config')),
    staleTime: Infinity,
  })

export const useBots = () =>
  useQuery({
    queryKey: ['bots'],
    queryFn: async () => unwrap(await api.GET('/api/v1/practice/bots')),
    staleTime: Infinity,
  })
