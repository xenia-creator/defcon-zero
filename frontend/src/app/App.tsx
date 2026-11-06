import { useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useEffect, useState } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Button, ConnectionStatus, Countdown, Defcon, Empty, Toasts } from '../components/ui'
import { useAuth } from '../lib/auth'
import { API_URL } from '../lib/config'
import { useCurrentRound, useTeam } from '../lib/queries'
import { WarMapPreview } from '../warmap/WarMapPreview'
import { ClaimCountry } from '../workspace/auth/ClaimCountry'
import { Login } from '../workspace/auth/Login'
import { OrganiserConsole } from '../workspace/organiser/OrganiserConsole'
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


export function App() {
  const session = useAuth((s) => s.session)
  const logout = useAuth((s) => s.logout)
  const queries = useQueryClient()
  const team = session?.team
  const signedIn = !!session
  useTeamSync(!!team)
  const { data: round } = useCurrentRound()

  const [activeTab, setActiveTab] = useState<'workspace' | 'warmap' | 'command'>(team ? 'workspace' : 'warmap')
  const [selectedRound, setSelectedRound] = useState<1 | 2 | 3>(1)

  async function switchRound(index: 1 | 2 | 3) {
    setSelectedRound(index)
    try {
      await fetch(`${API_URL}/__mock/goto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      })
      queries.invalidateQueries({ queryKey: ['round'] })
      queries.invalidateQueries({ queryKey: ['warmap-standings'] })
      queries.invalidateQueries({ queryKey: ['admin-overview'] })
    } catch {
      // mock endpoint only available in local demo
    }
  }

  // However the session ended, the next person must not see this team's data
  useEffect(() => {
    if (!signedIn) queries.clear()
  }, [signedIn, queries])

  if (!session) return <Login />

  const needsCountry = !!team && !team.territory_code
  const isMapActive = activeTab === 'warmap' || (!team && activeTab === 'workspace')
  const isCommandActive = activeTab === 'command'
  const activeRoundNumber = (round?.number as 1 | 2 | 3 | undefined) ?? selectedRound

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
          <nav className="flex gap-1" aria-label="Views">
            {team && (
              <button
                onClick={() => setActiveTab('workspace')}
                className={`cursor-pointer border-b-2 px-3 py-4 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase transition-colors ${!isMapActive && !isCommandActive ? 'border-alert text-paper' : 'border-transparent text-muted hover:text-paper'}`}
              >
                <span className="mr-2 text-alert">01</span>
                {needsCountry ? 'Claim nation' : 'Workspace'}
              </button>
            )}
            <button
              onClick={() => setActiveTab('warmap')}
              className={`cursor-pointer border-b-2 px-3 py-4 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase transition-colors ${isMapActive ? 'border-alert text-paper' : 'border-transparent text-muted hover:text-paper'}`}
            >
              <span className="mr-2 text-alert">{team ? '02' : '01'}</span>
              Big Board · War Map
            </button>
            <button
              onClick={() => setActiveTab('command')}
              className={`cursor-pointer border-b-2 px-3 py-4 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase transition-colors ${isCommandActive ? 'border-alert text-paper' : 'border-transparent text-muted hover:text-paper'}`}
            >
              <span className="mr-2 text-alert">{team ? '03' : '02'}</span>
              Command Console
            </button>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="flex items-center border border-steel bg-panel/80 p-0.5" title="Switch demo round">
            {([1, 2, 3] as const).map((r) => (
              <button
                key={r}
                onClick={() => switchRound(r)}
                className={`cursor-pointer px-2 py-1 font-mono text-[10px] font-bold tracking-widest uppercase transition-colors ${
                  activeRoundNumber === r ? 'bg-alert text-white' : 'text-muted hover:text-paper'
                }`}
              >
                R{r}
              </button>
            ))}
          </div>
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

      <main className={`min-h-0 flex-1 flex flex-col ${isMapActive ? 'overflow-hidden h-full' : 'overflow-y-auto'}`}>
        {isCommandActive ? (
          <OrganiserConsole />
        ) : isMapActive || !team ? (
          <WarMapPreview roundOverride={activeRoundNumber} />
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
