import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, Button, Panel, WindowTimer, useConfirm } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { API_URL, USE_MOCK_API } from '../../lib/config'
import { useLive } from '../../lib/live'
import { useCurrentRound } from '../../lib/queries'
import { ROUNDS, gameName, roundByGame } from '../../lib/rounds'

interface AdminTeamRow {
  team_id: number
  username: string
  nation_name: string
  territory_code: string | null
  status: 'active' | 'eliminated' | 'disqualified'
  is_bot: boolean
  submission: {
    version: number
    status: string
    passed: number
    total: number
    submitted_at: string
  } | null
  score: number
}

interface AdminOverview {
  round: {
    id: number
    number: number
    game: string
    status: string
    opens_at: string | null
    closes_at: string | null
  }
  teams: AdminTeamRow[]
  server_time: string
}

export function OrganiserConsole() {
  const token = useAuth((s) => s.session?.access)
  const toast = useLive((s) => s.toast)
  const queries = useQueryClient()
  const { data: round } = useCurrentRound()
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)

  const { data: overview, refetch } = useQuery<AdminOverview>({
    queryKey: ['admin-overview', round?.id],
    queryFn: async () => {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_URL}/admin/overview`, { headers })
      if (!res.ok) throw new Error('Could not load organiser telemetry')
      return res.json()
    },
    refetchInterval: 2_500,
  })

  const roundId = overview?.round.id ?? round?.id ?? 1
  const roundNumber = overview?.round.number ?? round?.number ?? 1
  const roundStatus = overview?.round.status ?? round?.status ?? 'open'
  const gameKey = overview?.round.game ?? round?.game ?? 'prisoners_dilemma'

  async function runAction(label: string, path: string, method: 'POST' | 'PATCH' = 'POST', body: unknown = {}) {
    setBusy(label)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Action failed' }))
        throw new Error(err.detail || 'Command failed')
      }
      toast('good', label)
      await Promise.all([
        refetch(),
        queries.invalidateQueries({ queryKey: ['round'] }),
        queries.invalidateQueries({ queryKey: ['warmap-standings'] }),
        queries.invalidateQueries({ queryKey: ['warmap-territories'] }),
        queries.invalidateQueries({ queryKey: ['team'] }),
      ])
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : 'Command failed')
    } finally {
      setBusy(null)
    }
  }

  const teams = overview?.teams ?? []
  const humanTeams = teams.filter((t) => !t.is_bot)
  const readyCount = humanTeams.filter((t) => t.submission?.status === 'accepted').length

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 p-6 lg:grid-cols-12">
      {dialog}
      {/* Left column: Round Lifecycle & Window Controls */}
      <div className="space-y-5 lg:col-span-5">
        <Panel
          title={`Round ${roundNumber} Control`}
          right={<Badge status={roundStatus} />}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between border border-steel bg-ink/80 p-4">
              <div>
                <p className="label">Active Theatre</p>
                <p className="mt-1 text-lg font-bold tracking-wider uppercase">{gameName(gameKey)}</p>
                {roundByGame(gameKey) && <p className="label !text-amber">{roundByGame(gameKey)!.also}</p>}
              </div>
              <WindowTimer round={round} />
            </div>

            {/* Demo only: /__mock/goto exists only on the local mock server, never on the real backend */}
            {USE_MOCK_API && (
              <div className="flex items-center justify-between gap-3 border border-dashed border-steel px-3 py-2">
                <p className="label !text-[10px]">Mock demo · jump to round</p>
                <div className="flex gap-1">
                  {ROUNDS.map((r) => (
                    <button
                      key={r.number}
                      type="button"
                      disabled={!!busy}
                      title={`Round ${r.number}: ${r.name} (DEFCON ${r.defcon})`}
                      onClick={() => void runAction(`Jumped to Round ${r.number}: ${r.name}`, '/__mock/goto', 'POST', { index: r.number })}
                      className={`cursor-pointer px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest transition-colors disabled:cursor-not-allowed ${
                        roundNumber === r.number ? 'bg-alert text-white' : 'text-muted hover:text-paper'
                      }`}
                    >
                      R{r.number}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="label mb-2">Submission Window Adjustments</p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => runAction('Added +5 minutes to submission window', `/admin/rounds/${roundId}/extend`, 'POST', { minutes: 5 })}
                >
                  +5 Min
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => runAction('Added +10 minutes to submission window', `/admin/rounds/${roundId}/extend`, 'POST', { minutes: 10 })}
                >
                  +10 Min
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => runAction(`Opened Round ${roundNumber} submission window`, `/admin/rounds/${roundId}/open`, 'POST', { minutes: 20 })}
                >
                  Re-open (20m)
                </Button>
              </div>
            </div>

            <div className="space-y-2 border-t border-steel pt-4">
              <p className="label mb-2">Stage Execution</p>
              <Button
                variant="primary"
                className="w-full"
                disabled={!!busy}
                onClick={() =>
                  ask({
                    title: `Close Round ${roundNumber} window & start tournament?`,
                    body: 'Teams will no longer be able to transmit new strategy orders for this round. The Python engine will score all accepted orders.',
                    confirmLabel: 'Close window · Start matches',
                    run: () => {
                      void runAction(`Round ${roundNumber} tournament matches executed`, `/admin/rounds/${roundId}/start`)
                    },
                  })
                }
              >
                Close Window · Start Matches
              </Button>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    ask({
                      title: `Publish Round ${roundNumber} standings to Big Board?`,
                      body: 'Final round scores and ranks will be locked on the War Map.',
                      confirmLabel: 'Publish results',
                      run: () => {
                        void runAction(`Published Round ${roundNumber} results to Big Board`, `/admin/rounds/${roundId}/publish`)
                      },
                    })
                  }
                >
                  Publish Results
                </Button>
                {/* Mock-only: /__mock/reset exists only on the local mock server */}
                {USE_MOCK_API && (
                  <Button
                    variant="danger"
                    disabled={!!busy}
                    onClick={() =>
                      ask({
                        title: 'Reset entire event state?',
                        body: 'All claimed territories, submissions, and round timers will be restored to initial state.',
                        confirmLabel: 'Reset event',
                        run: () => {
                          void runAction('Event state reset', '/__mock/reset')
                        },
                      })
                    }
                  >
                    Reset Event
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Organiser Telemetry">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="border border-steel bg-ink/60 p-3">
              <p className="label">Human Teams</p>
              <p className="mono mt-1 text-2xl font-bold text-paper">{humanTeams.length}</p>
            </div>
            <div className="border border-steel bg-ink/60 p-3">
              <p className="label">Orders Ready</p>
              <p className="mono mt-1 text-2xl font-bold text-coop">
                {readyCount}/{humanTeams.length}
              </p>
            </div>
            <div className="border border-steel bg-ink/60 p-3">
              <p className="label">Total Nations</p>
              <p className="mono mt-1 text-2xl font-bold text-amber">{teams.length}</p>
            </div>
          </div>
        </Panel>
      </div>

      {/* Right column: Competing Teams & Disqualification Roster */}
      <div className="lg:col-span-7">
        <Panel
          title={`Competing Nations (${teams.length})`}
          right={<span className="mono text-xs text-muted">LIVE ROSTER · ROUND {roundNumber}</span>}
        >
          <div className="divide-y divide-steel border border-steel bg-ink/60">
            {teams.map((t) => {
              const sub = t.submission
              return (
                <div key={t.team_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="mono text-xs font-bold text-alert">{t.territory_code ?? '--'}</span>
                      <span className="truncate font-bold tracking-wider uppercase">{t.nation_name}</span>
                      <Badge status={t.is_bot ? 'draft' : t.username} />
                      {t.status !== 'active' && <Badge status={t.status} />}
                    </div>
                    <div className="mono mt-1 text-xs text-muted">
                      {sub ? (
                        sub.status === 'accepted' ? (
                          <span className="text-coop">
                            ● v{sub.version} accepted ({sub.passed}/{sub.total} bots)
                          </span>
                        ) : (
                          <span className="text-alert">✕ v{sub.version} rejected</span>
                        )
                      ) : (
                        <span>○ No orders filed yet</span>
                      )}
                      <span className="ml-3 text-paper/80">Score: {t.score.toLocaleString()} PTS</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {t.status === 'active' ? (
                      <Button
                        variant="danger"
                        className="!px-3 !py-1.5 !text-[10px]"
                        disabled={!!busy}
                        onClick={() =>
                          ask({
                            title: `Disqualify ${t.nation_name}?`,
                            body: `${t.nation_name} will be marked disqualified on the War Map and excluded from active scoring.`,
                            confirmLabel: 'Disqualify nation',
                            run: () => {
                              void runAction(
                                `Disqualified ${t.nation_name}`,
                                `/admin/teams/${t.team_id}`,
                                'PATCH',
                                { status: 'disqualified' },
                              )
                            },
                          })
                        }
                      >
                        Disqualify
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="!px-3 !py-1.5 !text-[10px]"
                        disabled={!!busy}
                        onClick={() =>
                          runAction(
                            `Restored ${t.nation_name} to active status`,
                            `/admin/teams/${t.team_id}`,
                            'PATCH',
                            { status: 'active' },
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}
