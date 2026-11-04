import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useEffect } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Button, ConnectionStatus, Countdown, Defcon, Empty, Toasts } from '../components/ui'
import { ClaimCountry } from '../workspace/auth/ClaimCountry'
import { Login } from '../workspace/auth/Login'
import { FullscreenBanner, useFairplayReporting } from '../workspace/fairplay/fairplay'
import { api, unwrap } from '../lib/api'
import { useAuth } from '../lib/auth'
import { syncClock } from '../lib/clock'
import { handleEvent } from '../lib/live'
import { useCurrentRound } from '../lib/queries'
import { Realtime } from '../lib/realtime'

// Monaco and Blockly are large, so the workspace loads only once a team has its nation
const Workspace = lazy(() => import('../workspace/editor/Workspace').then((m) => ({ default: m.Workspace })))

const CLOCK_SYNC_MS = 30_000

function useRealtime(active: boolean, teamId: string | null | undefined) {
  const queries = useQueryClient()
  useEffect(() => {
    if (!active) return
    const realtime = new Realtime((message) => handleEvent(message, queries))
    realtime.start()
    syncClock().catch(() => {})
    const clock = setInterval(() => syncClock().catch(() => {}), CLOCK_SYNC_MS)
    return () => {
      realtime.stop()
      clearInterval(clock)
    }
  }, [active, teamId, queries])
}

/** Keeps the stored user (and its team, e.g. when it falls) in sync with the server. */
function useMe(active: boolean) {
  const setUser = useAuth((s) => s.setUser)
  const { data } = useQuery({
    queryKey: ['teams', 'me'],
    enabled: active,
    queryFn: async () => unwrap(await api.GET('/api/v1/me')),
  })
  useEffect(() => {
    if (data) setUser(data)
  }, [data, setUser])
}

const STEPS = ['Claim nation', 'Workspace']

export function App() {
  const session = useAuth((s) => s.session)
  const logout = useAuth((s) => s.logout)
  const queries = useQueryClient()
  const user = session?.user
  const team = user?.team
  const signedIn = !!session
  useRealtime(signedIn, team?.id)
  useMe(signedIn)
  useFairplayReporting(!!team)
  const { data: round } = useCurrentRound()

  // However the session ended, the next person must not see this team's data
  useEffect(() => {
    if (!signedIn) queries.clear()
  }, [signedIn, queries])

  if (!session || !user) return <Login />

  const needsCountry = !!team && !team.country_code
  const step = needsCountry ? 0 : 1

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-steel bg-ink/90 px-5">
        <div className="flex min-w-0 items-center gap-8">
          <span className="flex items-center gap-3">
            <span className="h-3 w-3 bg-alert shadow-[0_0_12px_var(--color-alert)]" />
            <span className="text-lg font-bold tracking-[0.3em] whitespace-nowrap text-alert">DEFCON ZERO</span>
          </span>
          {team && (
            <nav className="hidden gap-1 xl:flex" aria-label="Progress">
              {STEPS.map((label, i) => (
                <span key={label} className={`border-b-2 px-3 py-4 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase ${step === i ? 'border-alert text-paper' : 'border-transparent text-muted'}`}>
                  <span className="mr-2 text-alert">0{i + 1}</span>
                  {label}
                </span>
              ))}
            </nav>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <Countdown round={round} />
          <ConnectionStatus />
          <Defcon round={round} />
          <span className="text-sm whitespace-nowrap">
            <span className="text-muted">{team ? team.name : user.role}</span>
            <button onClick={() => logout()} className="label ml-3 cursor-pointer !text-[10px] hover:!text-alert">
              Log out
            </button>
          </span>
        </div>
      </header>
      {team && <FullscreenBanner />}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {!team ? (
          <Empty>This account ({user.role}) has no team. The team workspace is only for competing teams.</Empty>
        ) : needsCountry ? (
          <ClaimCountry user={user} />
        ) : (
          <ErrorBoundary
            resetKey={team.id}
            fallback={() => (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-sm text-muted">The workspace could not load. Your draft is saved in this browser.</p>
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              </div>
            )}
          >
            <Suspense fallback={<Empty>Loading your workspace…</Empty>}>
              {/* Keyed so another team logging in on this machine never inherits this team's editor */}
              <Workspace key={team.id} team={team} />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
      <Toasts />
      <div className="scanlines" />
    </div>
  )
}
