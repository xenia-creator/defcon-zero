import { useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useEffect } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Button, ConnectionStatus, Countdown, Defcon, Empty, Toasts } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useCurrentRound, useTeam } from '../lib/queries'
import { WarMapPreview } from '../warmap/WarMapPreview'
import { ClaimCountry } from '../workspace/auth/ClaimCountry'
import { Login } from '../workspace/auth/Login'
import { windowRemaining } from '../lib/clock'
import { useServerNow } from '../lib/clock'

// Monaco and Blockly are large, so the workspace loads only once a team has its nation
const Workspace = lazy(() => import('../workspace/editor/Workspace').then((m) => ({ default: m.Workspace })))

/** Keeps the stored team (for example when it falls) in sync with the server. */
function useTeamSync(active: boolean) {
  const setTeam = useAuth((s) => s.setTeam)
  const { data } = useTeam(active)
  useEffect(() => {
    if (data) setTeam(data)
  }, [data, setTeam])
}

function ZoneOverlay({ round }: { round: ReturnType<typeof useCurrentRound>['data'] }) {
  const now = useServerNow()
  const seconds = windowRemaining(round, now)
  if (seconds === null || seconds > 300) return null
  if (seconds < 60) return <div className="zone-critical" aria-hidden />
  return <div className="zone-closing" aria-hidden />
}

const STEPS = ['Claim nation', 'Workspace']

export function App() {
  const session = useAuth((s) => s.session)
  const logout = useAuth((s) => s.logout)
  const queries = useQueryClient()
  const team = session?.team
  const signedIn = !!session
  useTeamSync(!!team)
  const { data: round } = useCurrentRound()

  // However the session ended, the next person must not see this team's data
  useEffect(() => {
    if (!signedIn) queries.clear()
  }, [signedIn, queries])

  if (!session) return <Login />

  const needsCountry = !!team && !team.territory_code
  const step = needsCountry ? 0 : 1

  return (
    <div className="flex h-screen flex-col">
      {/* War-room top bar */}
      <header className="relative flex h-14 shrink-0 items-center justify-between gap-4 border-b border-steel bg-ink/95 px-5 panel-3d z-20">
        {/* left side corner decoration */}
        <span className="absolute left-0 top-0 h-3 w-3 border-r border-b border-steel-light opacity-60" aria-hidden />
        <span className="absolute right-0 bottom-0 h-3 w-3 border-l border-t border-steel-light opacity-60" aria-hidden />

        <div className="flex min-w-0 items-center gap-8">
          <span className="flex items-center gap-3 logo-flicker">
            <span className="h-3 w-3 bg-alert shadow-[0_0_14px_2px_var(--color-alert)] blink" aria-hidden />
            <span className="text-lg font-bold tracking-[0.3em] whitespace-nowrap text-alert glow select-none">DEFCON ZERO</span>
          </span>
          {team && (
            <nav className="hidden gap-1 xl:flex" aria-label="Progress">
              {STEPS.map((label, i) => (
                <span key={label} className={`border-b-2 px-3 py-4 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase transition-colors ${step === i ? 'border-alert text-paper' : 'border-transparent text-muted'}`}>
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
          <span className="text-sm whitespace-nowrap border-l border-steel pl-4">
            <span className="text-muted">{team?.nation_name ?? session.username}</span>
            <button onClick={() => logout()} className="label ml-3 cursor-pointer !text-[10px] hover:!text-alert transition-colors">
              Log out
            </button>
          </span>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!team ? (
          <WarMapPreview />
        ) : needsCountry ? (
          <ClaimCountry username={session.username} />
        ) : (
          <ErrorBoundary
            resetKey={String(team.id)}
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
      <ZoneOverlay round={round} />
    </div>
  )
}
