import { useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useEffect, useState } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { RoundIntro } from '../components/RoundIntro'
import { Button, ConnectionStatus, Countdown, Defcon, Empty, Toasts } from '../components/ui'
import { useAuth, type Session } from '../lib/auth'
import { isClaimed } from '../lib/contract'
import { windowRemaining, useServerNow } from '../lib/clock'
import { useCurrentRound, useTeam } from '../lib/queries'
import { gameName } from '../lib/rounds'
import { WarMapPreview } from '../warmap/WarMapPreview'
import { ClaimCountry } from '../workspace/auth/ClaimCountry'
import { Login } from '../workspace/auth/Login'
import { OrganiserConsole } from '../workspace/organiser/OrganiserConsole'
import { VIEW_LABELS, seesStandings, viewsFor, type View } from './views'

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
  const queries = useQueryClient()
  const signedIn = !!session

  // However the session ended, the next person must not see this team's data
  useEffect(() => {
    if (!signedIn) queries.clear()
  }, [signedIn, queries])

  if (!session) return <Login />
  // Keyed by who is signed in, so the chosen view never carries over to the next person on this machine
  return <Shell key={`${session.role}:${session.username}:${session.team?.team_id ?? ''}`} session={session} />
}

function Shell({ session }: { session: Session }) {
  const logout = useAuth((s) => s.logout)
  const team = session.team
  useTeamSync(!!team)
  const { data: round } = useCurrentRound()

  const views = viewsFor(session)
  const [chosen, setChosen] = useState<View | undefined>(views[0])
  const view = chosen && views.includes(chosen) ? chosen : views[0]
  // A team works on the current round only; with nothing else to open, the bar names that round instead of tabs
  const singleView = views.length <= 1
  // team_id stays null until the team claims its nation, so an unclaimed team goes to the claim flow, never the workspace
  const needsCountry = !!team && (!isClaimed(team) || !team.territory_code)

  return (
    <div className="flex h-screen flex-col">
      {/* War-room top bar: brand and views on the left, one status group and the user on the right.
          Wraps onto a second line when the window is too narrow, instead of overlapping. */}
      <header className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-steel bg-ink/95 px-3 py-1 panel-3d sm:px-5">
        <span className="absolute top-0 left-0 h-3 w-3 border-r border-b border-steel-light opacity-60" aria-hidden />
        <span className="absolute right-0 bottom-0 h-3 w-3 border-t border-l border-steel-light opacity-60" aria-hidden />

        <div className="flex min-w-0 max-w-full items-center gap-3 sm:gap-6">
          <span className="flex shrink-0 items-center gap-3">
            <span className="h-3 w-1.5 bg-fire" aria-hidden />
            <span className="stencil text-xl tracking-[0.2em] whitespace-nowrap text-paper glow select-none">DEFCON ZERO</span>
          </span>
          {views.length > 1 && (
            <nav className="flex min-w-0 gap-1 overflow-x-auto" aria-label="Views">
              {views.map((v, i) => (
                <button
                  key={v}
                  onClick={() => setChosen(v)}
                  aria-current={view === v ? 'page' : undefined}
                  className={`cursor-pointer border-b-2 px-3 py-3 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase transition-colors sm:py-4 ${
                    view === v ? 'border-fire text-paper' : 'border-transparent text-muted hover:text-paper'
                  }`}
                >
                  <span className="mr-2 text-fire">0{i + 1}</span>
                  {v === 'workspace' && needsCountry ? 'Claim nation' : VIEW_LABELS[v]}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border border-steel bg-panel/60 px-3 py-1">
            {/* The war map shows DEFCON and the game in its own header, so the bar doesn't repeat them there */}
            {view !== 'warmap' && (
              <>
                <Defcon round={round} compact />
                {round && (
                  <span className={`hidden max-w-64 truncate text-xs tracking-wider whitespace-nowrap text-muted ${singleView ? 'lg:inline' : '2xl:inline'}`} title={gameName(round.game)}>
                    Round {round.number} · <span className="text-paper">{gameName(round.game)}</span>
                  </span>
                )}
              </>
            )}
            <Countdown round={round} />
            <ConnectionStatus />
          </div>
          <span className="flex items-center gap-3 text-sm whitespace-nowrap">
            <span className="max-w-40 truncate text-muted" title={team?.nation_name ?? session.username}>
              {team?.nation_name ?? session.username}
            </span>
            <button onClick={() => logout()} className="label cursor-pointer !text-[10px] transition-colors hover:!text-fire">
              Log out
            </button>
          </span>
        </div>
      </header>

      {/* The analyst's desk behind the team workspace (not the claim screen, which has its own image) */}
      <main
        className={`flex min-h-0 flex-1 flex-col ${view === 'warmap' ? 'h-full overflow-hidden max-[900px]:overflow-y-auto' : 'overflow-y-auto'} ${
          view === 'workspace' && team && !needsCountry ? 'workspace-backdrop' : ''
        }`}
      >
        {view === 'command' ? (
          <OrganiserConsole />
        ) : view === 'warmap' ? (
          <WarMapPreview showStandings={seesStandings(session)} />
        ) : view !== 'workspace' || !team ? (
          <Empty>This account has nothing to show yet. Ask an organiser to check it is linked to a team.</Empty>
        ) : !isClaimed(team) || !team.territory_code ? (
          <ClaimCountry username={session.username} />
        ) : (
          <ErrorBoundary
            resetKey={String(team.team_id)}
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
              <Workspace key={team.team_id} team={team} />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
      <Toasts />
      <div className="film-grain" aria-hidden />
      <ZoneOverlay round={round} />
      {/* Not over the Command Console: it would cover the controls the organiser just used */}
      <RoundIntro round={round} enabled={view !== 'command'} />
    </div>
  )
}
