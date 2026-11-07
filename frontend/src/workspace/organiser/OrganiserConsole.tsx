import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Badge, Button, Empty, LoadFailed, Panel, inputClass, useConfirm } from '../../components/ui'
import { errorMessage, request } from '../../lib/api'
import { formatDuration, syncClock, useClock, useServerNow, windowRemaining } from '../../lib/clock'
import { USE_MOCK_API } from '../../lib/config'
import type { RoundStatus } from '../../lib/contract'
import { useLive } from '../../lib/live'
import { admin, useAdminOverview, useRefreshAfterAdmin, useRounds } from '../../lib/queries'
import { ROUNDS, gameName, roundByGame } from '../../lib/rounds'
import {
  DEFAULT_EXTEND_MINUTES,
  DEFAULT_OPEN_MINUTES,
  UNREACHABLE,
  actionErrorMessage,
  allowedActions,
  checkMinutes,
  cutFor,
  isTournamentComplete,
  nextRound,
  type RoundActionKind,
} from './actions'
import { Roster, UnclaimedPanel } from './RosterTable'

const ROUND_ACTION_KINDS: readonly string[] = ['open', 'extend', 'start', 'retry', 'publish', 'open-next'] satisfies RoundActionKind[]
const isRoundAction = (key: string): key is RoundActionKind => ROUND_ACTION_KINDS.includes(key)

/** A date from the server as milliseconds, or null when missing or unreadable. */
const ms = (text: string | null) => {
  const value = text ? Date.parse(text) : NaN
  return Number.isNaN(value) ? null : value
}

/** /__mock/* answers aren't part of the contract, so nothing about them is checked. */
const MockAnswer = z.unknown()

export function OrganiserConsole() {
  const toast = useLive((s) => s.toast)
  const refresh = useRefreshAfterAdmin()
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  /** The last round action's error, kept in the panel (toasts fade) until a round action succeeds. */
  const [roundError, setRoundError] = useState<string | null>(null)
  const [openMinutes, setOpenMinutes] = useState(String(DEFAULT_OPEN_MINUTES))
  const [extendMinutes, setExtendMinutes] = useState(String(DEFAULT_EXTEND_MINUTES))

  // One source for the timer and the buttons: the overview, and its server_time for the clock
  const { data: overview, dataUpdatedAt, isPending, isError, refetch } = useAdminOverview()
  useEffect(() => {
    // The shared hook doesn't record when the request left, so the answer's arrival stands in for both ends
    if (overview) syncClock(dataUpdatedAt, ms(overview.server_time), dataUpdatedAt)
  }, [overview, dataUpdatedAt])

  const round = overview?.round ?? null
  const actions = allowedActions(round)
  const can = (kind: string) => actions.some((a) => a.kind === kind)

  // GET /rounds only matters once a round is published: it holds the next round's id
  const rounds = useRounds()
  const next = round && can('open-next') ? nextRound(rounds.data, round) : undefined

  // A new round or status starts both fields from their defaults again
  useEffect(() => {
    setOpenMinutes(String(DEFAULT_OPEN_MINUTES))
    setExtendMinutes(String(DEFAULT_EXTEND_MINUTES))
  }, [round?.id, round?.status])

  /**
   * Runs one action at a time, then refetches everything it can change, whether it worked or not:
   * after INVALID_ROUND_TRANSITION the screen catches up with the round as it is now.
   * `key` is a round action's kind (its errors are explained by code) or any other label.
   */
  async function run(key: RoundActionKind | string, done: string, action: () => Promise<unknown>) {
    // A second click before the re-render must not send the request twice
    if (inFlight.current) return
    inFlight.current = true
    setBusy(key)
    try {
      await action()
      toast('good', done)
      if (isRoundAction(key)) setRoundError(null)
    } catch (err) {
      const message = isRoundAction(key) ? actionErrorMessage(key, err) : errorMessage(err, UNREACHABLE)
      toast('bad', message)
      if (isRoundAction(key)) setRoundError(message)
    } finally {
      await refresh()
      inFlight.current = false
      setBusy(null)
    }
  }

  const openCheck = checkMinutes(openMinutes)
  const extendCheck = checkMinutes(extendMinutes)

  const teams = overview?.teams ?? []
  const readyCount = teams.filter((t) => t.submission?.status === 'accepted').length

  // Before the first good answer: loading, a failed load, or no rounds at all (404 → null)
  if (overview === undefined || overview === null) {
    return (
      <div className="mx-auto w-full max-w-xl p-6">
        <Panel title="Command Console">
          {isPending ? (
            <Empty>Loading the console…</Empty>
          ) : isError ? (
            <LoadFailed what="the organiser overview" onRetry={() => void refetch()} />
          ) : (
            <Empty>No rounds created yet</Empty>
          )}
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 p-6 lg:grid-cols-12">
      {dialog}
      {/* A failed poll keeps the last good overview on screen, marked as possibly out of date */}
      {isError && (
        <p role="status" className="border border-amber/50 px-3 py-2 text-xs text-amber lg:col-span-12">
          Lost contact with the server. Showing the last update; it will refresh when the connection returns.
        </p>
      )}
      {/* Top row: round lifecycle and telemetry, side by side */}
      <div className="grid grid-cols-1 items-start gap-5 lg:col-span-12 lg:grid-cols-2">
        <Panel title={round ? `Round ${round.number} Control` : 'Round Control'} right={round && <Badge status={round.status} />}>
          <div className="space-y-4">
            {roundError && (
              <p role="alert" data-testid="round-error" className="border border-alert-dim px-3 py-2 text-xs text-alert">
                {roundError}
              </p>
            )}
            {round && (
              <div className="flex items-center justify-between border border-steel bg-ink/80 p-4">
                <div>
                  <p className="label">Active Theatre</p>
                  <p className="mt-1 text-lg font-bold tracking-wider uppercase">{gameName(round.game)}</p>
                  {roundByGame(round.game) && <p className="label !text-amber">{roundByGame(round.game)!.also}</p>}
                </div>
                <ConsoleTimer status={round.status} closesAt={ms(round.closes_at)} />
              </div>
            )}

            {/* Demo only: USE_MOCK_API is true only on the dev server in mock mode, never against the real backend */}
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
                      onClick={() => void run('mock-goto', `Jumped to Round ${r.number}: ${r.name}`, () => request('POST', '/__mock/goto', MockAnswer, { index: r.number }))}
                      className={`cursor-pointer px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest transition-colors disabled:cursor-not-allowed ${
                        round?.number === r.number ? 'bg-alert text-white' : 'text-muted hover:text-paper'
                      }`}
                    >
                      R{r.number}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {round && can('open') && (
              <MinutesAction
                label={`Open Round ${round.number}`}
                hint="Submission window, in minutes"
                value={openMinutes}
                onChange={setOpenMinutes}
                error={openCheck.ok ? null : openCheck.message}
                disabled={!!busy || !openCheck.ok}
                busy={busy === 'open'}
                onRun={() => {
                  if (!openCheck.ok) return
                  const minutes = openCheck.minutes
                  void run('open', `Opened Round ${round.number} for ${minutes} minutes`, () => admin.open(round.id, minutes))
                }}
              />
            )}

            {round && can('extend') && (
              <MinutesAction
                label="Extend window"
                hint="Add minutes to the window"
                value={extendMinutes}
                onChange={setExtendMinutes}
                error={extendCheck.ok ? null : extendCheck.message}
                disabled={!!busy || !extendCheck.ok}
                busy={busy === 'extend'}
                onRun={() => {
                  if (!extendCheck.ok) return
                  const minutes = extendCheck.minutes
                  void run('extend', `Added ${minutes} minutes to Round ${round.number}`, () => admin.extend(round.id, minutes))
                }}
              />
            )}

            {round && can('start') && (
              <div className="space-y-2 border-t border-steel pt-4">
                <p className="label mb-2">Stage Execution</p>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!!busy}
                  onClick={() =>
                    ask({
                      title: `Close submissions and start Round ${round.number}?`,
                      body: "Teams can't submit after this.",
                      confirmLabel: `Start Round ${round.number}`,
                      run: () => void run('start', `Round ${round.number} started`, () => admin.start(round.id)),
                    })
                  }
                >
                  {busy === 'start' ? 'Starting…' : 'Close Window · Start Matches'}
                </Button>
              </div>
            )}

            {round && can('retry') && (
              <div className="space-y-2 border-t border-steel pt-4">
                <p className="text-sm text-amber blink">Matches playing…</p>
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={!!busy}
                  onClick={() =>
                    ask({
                      title: `Retry Round ${round.number}?`,
                      body: `Replay all of Round ${round.number}'s matches from the start? Only use this if the run failed.`,
                      confirmLabel: 'Replay matches',
                      run: () => void run('retry', `Replaying Round ${round.number}'s matches`, () => admin.retry(round.id)),
                    })
                  }
                >
                  {busy === 'retry' ? 'Sending…' : 'Retry Matches'}
                </Button>
              </div>
            )}

            {round && can('publish') && (
              <div className="space-y-2 border-t border-steel pt-4">
                <p className="label mb-2">Results Ready</p>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!!busy}
                  onClick={() => {
                    const cut = cutFor(round.number)
                    ask({
                      title: `Publish Round ${round.number}?`,
                      body: `Results go public, the ${cut === undefined ? 'top teams' : `top ${cut}`} advance and everyone else is eliminated.`,
                      confirmLabel: `Publish Round ${round.number}`,
                      run: () => void run('publish', `Published Round ${round.number}`, () => admin.publish(round.id)),
                    })
                  }}
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish Results'}
                </Button>
              </div>
            )}

            {round && can('open-next') &&
              (next ? (
                <MinutesAction
                  label={`Open Round ${next.number}`}
                  hint="Submission window, in minutes"
                  value={openMinutes}
                  onChange={setOpenMinutes}
                  error={openCheck.ok ? null : openCheck.message}
                  disabled={!!busy || !openCheck.ok}
                  busy={busy === 'open-next'}
                  onRun={() => {
                    if (!openCheck.ok) return
                    const minutes = openCheck.minutes
                    void run('open-next', `Opened Round ${next.number} for ${minutes} minutes`, () => admin.open(next.id, minutes))
                  }}
                />
              ) : (
                rounds.isError && !rounds.data ? (
                  <LoadFailed what="the next round" onRetry={() => void rounds.refetch()} />
                ) : (
                  <p className="text-sm text-muted">{rounds.isPending ? 'Loading the next round…' : `Round ${round.number + 1} is not waiting to open.`}</p>
                )
              ))}

            {isTournamentComplete(round) && <p className="border border-coop/50 p-3 text-center font-bold tracking-widest text-coop uppercase">Tournament complete</p>}

            {/* Mock-only: /__mock/reset exists only on the local mock server */}
            {USE_MOCK_API && (
              <div className="border-t border-steel pt-4">
                <Button
                  variant="danger"
                  className="w-full"
                  disabled={!!busy}
                  onClick={() =>
                    ask({
                      title: 'Reset entire event state?',
                      body: 'All claimed territories, submissions, and round timers will be restored to initial state.',
                      confirmLabel: 'Reset event',
                      run: () => void run('mock-reset', 'Event state reset', () => request('POST', '/__mock/reset', MockAnswer)),
                    })
                  }
                >
                  Reset Event
                </Button>
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Organiser Telemetry">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="border border-steel bg-ink/60 p-3">
                <p className="label">Teams</p>
                <p className="mono mt-1 text-2xl font-bold text-paper">{teams.length}</p>
              </div>
              <div className="border border-steel bg-ink/60 p-3">
                <p className="label">Orders Ready</p>
                <p className="mono mt-1 text-2xl font-bold text-coop">
                  {readyCount}/{teams.length}
                </p>
              </div>
            </div>
          </Panel>
          <UnclaimedPanel usernames={overview.unclaimed} />
        </div>
      </div>

      {/* Full width: the team roster has six columns plus its buttons */}
      <div className="lg:col-span-12">
        <Roster teams={overview.teams} round={overview.round} />
      </div>
    </div>
  )
}

/** A minutes field and its button, for Open and Extend. */
function MinutesAction({
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
  busy,
  onRun,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  error: string | null
  disabled: boolean
  busy: boolean
  onRun: () => void
}) {
  const id = `minutes-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) onRun()
      }}
    >
      <label htmlFor={id} className="label block">
        {hint}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          inputMode="numeric"
          className={`${inputClass} !w-24`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button type="submit" variant="ghost" className="flex-1" disabled={disabled}>
          {busy ? 'Sending…' : label}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-alert">
          {error}
        </p>
      )}
    </form>
  )
}

const WAITING: Record<RoundStatus, string> = {
  waiting: 'The window has not opened yet',
  open: 'The window is open',
  running: 'Matches are being played',
  review: 'Results are under review',
  published: 'Results are published',
}

/** Time left in the window: closes_at against server time (lib/clock), never this laptop's clock. */
function ConsoleTimer({ status, closesAt }: { status: RoundStatus; closesAt: number | null }) {
  const now = useServerNow()
  const synced = useClock((s) => s.synced)
  const seconds = windowRemaining({ status, closesAt }, now)
  if (seconds === null) return <p className="py-1 text-sm text-muted">{WAITING[status]}</p>
  const tone = seconds < 60 ? 'text-alert' : seconds < 300 ? 'text-amber' : 'text-coop'
  return (
    <div data-testid="console-timer" className="text-right">
      <span className="label !text-[11px] tracking-[0.2em]">{seconds > 0 ? 'Window closes in' : 'Window closing'}</span>
      <p className={`text-3xl font-bold tabular-nums ${tone} ${seconds < 60 ? 'blink' : ''}`}>{formatDuration(seconds)}</p>
      {!synced && <p className="mt-1 text-xs text-amber">Syncing with the server clock…</p>}
    </div>
  )
}
