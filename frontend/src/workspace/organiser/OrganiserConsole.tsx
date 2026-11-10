import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { FileNumber, Stamp } from '../../components/period'
import { Button, Empty, LoadFailed, Panel, inputClass, useConfirm } from '../../components/ui'
import { errorMessage, request } from '../../lib/api'
import { formatDuration, syncClock, useClock, useServerNow, windowRemaining } from '../../lib/clock'
import { USE_MOCK_API } from '../../lib/config'
import type { RoundStatus } from '../../lib/contract'
import { useLive } from '../../lib/live'
import { admin, useAdminOverview, useRefreshAfterAdmin, useRounds } from '../../lib/queries'
import { useTour } from '../../tour/useTour'
import { ROUNDS, gameName, roundByGame } from '../../lib/rounds'
import {
  DEFAULT_EXTEND_MINUTES,
  DEFAULT_OPEN_MINUTES,
  DEFAULT_SET_TIME_MINUTES,
  UNREACHABLE,
  actionErrorMessage,
  allowedActions,
  checkCut,
  checkMinutes,
  cutErrorMessage,
  isCutEditable,
  isRunFailed,
  isRunPlaying,
  isTournamentComplete,
  nextRound,
  type RoundActionKind,
} from './actions'
import './OrganiserConsole.css'
import { PAPER_FIELD, ROW_BUTTON, Roster, UnclaimedPanel } from './RosterTable'
import { formatTime } from './roster'

const ROUND_ACTION_KINDS: readonly string[] = ['open', 'extend', 'set-time', 'start', 'retry', 'publish', 'open-next'] satisfies RoundActionKind[]
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
  const [setTimeMinutes, setSetTimeMinutes] = useState(String(DEFAULT_SET_TIME_MINUTES))
  /** The last failed cut save, shown under the cut on the order sheet until a save works or the round moves on. */
  const [cutError, setCutError] = useState<string | null>(null)

  // One source for the timer and the buttons: the overview, and its server_time for the clock
  const { data: overview, dataUpdatedAt, isPending, isError, refetch } = useAdminOverview()
  // The tour waits for the overview: its steps point at the orders, controls and roster
  useTour('command', overview !== undefined && overview !== null, { role: 'organiser' })
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

  // A new round or status starts every field from its default again, and drops a stale cut error
  useEffect(() => {
    setOpenMinutes(String(DEFAULT_OPEN_MINUTES))
    setExtendMinutes(String(DEFAULT_EXTEND_MINUTES))
    setSetTimeMinutes(String(DEFAULT_SET_TIME_MINUTES))
    setCutError(null)
  }, [round?.id, round?.status])

  /**
   * Runs one action at a time, then refetches everything it can change, whether it worked or not:
   * after INVALID_ROUND_TRANSITION the screen catches up with the round as it is now.
   * `key` is a round action's kind (its errors are explained by code) or any other label, and
   * `explain` turns another action's error into words, by code too.
   */
  async function run(key: RoundActionKind | string, done: string, action: () => Promise<unknown>, explain?: (err: unknown) => string) {
    // A second click before the re-render must not send the request twice
    if (inFlight.current) return
    inFlight.current = true
    setBusy(key)
    try {
      await action()
      toast('good', done)
      if (isRoundAction(key)) setRoundError(null)
    } catch (err) {
      const message = isRoundAction(key) ? actionErrorMessage(key, err) : explain ? explain(err) : errorMessage(err, UNREACHABLE)
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
  const setTimeCheck = checkMinutes(setTimeMinutes)

  /** Saves a new cut for this round, after a confirm that names it. A failure stays under the field. */
  function saveCut(target: { id: number; number: number }, cut: number) {
    ask({
      title: `Set Round ${target.number}'s cut to ${cut}?`,
      body: `When Round ${target.number} is published, the top ${cut} advance and everyone else is eliminated.`,
      confirmLabel: `Set cut to ${cut}`,
      run: () =>
        void run(
          'cut',
          `Round ${target.number} now keeps the top ${cut}`,
          async () => {
            try {
              await admin.setCut(target.id, cut)
              setCutError(null)
            } catch (err) {
              setCutError(cutErrorMessage(err))
              throw err
            }
          },
          cutErrorMessage,
        ),
    })
  }

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

  const theatre = round ? roundByGame(round.game) : undefined
  /** The window as typed times (this browser's clock face, the server's timestamps). */
  const windowOpened = round?.opens_at ? formatTime(round.opens_at) : null
  const windowCloses = round?.closes_at ? formatTime(round.closes_at) : null

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 p-6 lg:grid-cols-12">
      {dialog}
      {/* A failed poll keeps the last good overview on screen, marked as possibly out of date */}
      {isError && (
        <p role="status" className="border-l-2 border-amber py-2 pl-4 font-label text-sm text-amber lg:col-span-12">
          Lost contact with the server. Showing the last update; it will refresh when the connection returns.
        </p>
      )}

      {/* The round's operations order: a typed document, its status stamped on it */}
      <article data-tour="ops-order" className="paper-sheet ops-sheet relative flex flex-col gap-6 p-6 sm:p-8 lg:col-span-7" aria-labelledby="ops-order-title">
        <header className="flex items-start justify-between gap-4 border-b border-type-muted pb-4">
          <div className="flex flex-col gap-2">
            <p className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">Operations order · Command console</p>
            <h2 id="ops-order-title" className="font-title text-3xl tracking-[0.06em]">
              {round ? `Round ${round.number} orders` : 'Round orders'}
            </h2>
            {round && <FileNumber prefix="Order" number={`OPS-0${round.number}`} className="self-start text-type-muted" />}
          </div>
          {round && (
            <span className="shrink-0 pt-2 pr-2">
              <Stamp tilt={-6} className={`text-2xl ${STATUS_STAMP[round.status].ink}`}>
                {STATUS_STAMP[round.status].text}
              </Stamp>
            </span>
          )}
        </header>

        {round && (
          <dl className="flex flex-col gap-4">
            <div className="ops-field">
              <dt className={FIELD_LABEL}>Theatre</dt>
              <dd className="font-label text-lg">{gameName(round.game)}</dd>
            </div>
            {theatre && (
              <div className="ops-field">
                <dt className={FIELD_LABEL}>Game</dt>
                <dd className="font-label text-lg">{theatre.also}</dd>
              </div>
            )}
            <div className="ops-field">
              <dt className={FIELD_LABEL}>The cut</dt>
              <dd className="font-label text-lg">
                {isCutEditable(round) ? (
                  <CutField round={round} disabled={!!busy} busy={busy === 'cut'} onSave={(cut) => saveCut(round, cut)} />
                ) : (
                  <span data-testid="cut-value">
                    Top <span className="font-data font-bold">{round.cut}</span> advance
                    {round.status !== 'published' && <span className="text-sm text-type-muted"> · fixed</span>}
                  </span>
                )}
              </dd>
            </div>
            {cutError && (
              <p role="alert" data-testid="cut-error" className="-mt-2 text-right font-label text-sm text-type-red">
                {cutError}
              </p>
            )}
            <div className="ops-field">
              <dt className={FIELD_LABEL}>Window</dt>
              <dd className="font-data text-lg">
                {windowOpened && windowCloses ? (
                  <>
                    {windowOpened} <span className="font-label text-type-muted">to</span> {windowCloses}
                  </>
                ) : (
                  <span className="font-label">Not yet opened</span>
                )}
              </dd>
            </div>
            <div className="ops-field">
              <dt className={FIELD_LABEL}>Teams on the roll</dt>
              <dd className="font-data text-lg font-bold">{teams.length}</dd>
            </div>
            <div className="ops-field">
              <dt className={FIELD_LABEL}>Orders ready</dt>
              <dd className="font-data text-lg font-bold">
                {readyCount} / {teams.length}
              </dd>
            </div>
          </dl>
        )}

        <div data-tour="ops-unclaimed" className="mt-auto border-t border-type-muted pt-4">
          <UnclaimedPanel usernames={overview.unclaimed} />
        </div>
      </article>

      {/* The control kit: the timer plate, then the one action the round allows (fire) */}
      <section data-tour="ops-controls" className="field-kit flex flex-col lg:col-span-5 lg:self-start" aria-labelledby="ops-controls-title">
        <header className="border-b border-steel px-6 py-4">
          <h2 id="ops-controls-title" className="font-title text-lg tracking-[0.1em] text-paper">
            {round ? `Round ${round.number} Control` : 'Round Control'}
          </h2>
        </header>
        <div className="flex flex-col gap-6 p-6">
          {round && <ConsoleTimer status={round.status} closesAt={ms(round.closes_at)} runFailed={isRunFailed(round)} />}

          {roundError && (
            <p role="alert" data-testid="round-error" className="ops-alert-text border-l-2 border-alert py-1 pl-4 font-label text-sm">
              {roundError}
            </p>
          )}

          {/* Demo only: USE_MOCK_API is true only on the dev server in mock mode, never against the real backend */}
          {USE_MOCK_API && (
            <div className="flex items-center justify-between gap-4 border border-dashed border-steel px-4 py-2">
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
              primary
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

          {round && can('set-time') && (
            <MinutesAction
              label="Set time left"
              hint="Or end the window this many minutes from now"
              value={setTimeMinutes}
              onChange={setSetTimeMinutes}
              error={setTimeCheck.ok ? null : setTimeCheck.message}
              disabled={!!busy || !setTimeCheck.ok}
              busy={busy === 'set-time'}
              onRun={() => {
                if (!setTimeCheck.ok) return
                const minutes = setTimeCheck.minutes
                ask({
                  title: `Set Round ${round.number} to end ${minutes} minutes from now?`,
                  body: 'This replaces the current deadline, so it can shorten the window as well as lengthen it. Teams see the new time straight away.',
                  confirmLabel: 'Set time left',
                  run: () => void run('set-time', `Round ${round.number} now ends ${minutes} minutes from now`, () => admin.setTime(round.id, minutes)),
                })
              }}
            />
          )}

          {round && can('start') && (
            <div className="flex flex-col gap-2 border-t border-steel pt-6">
              <p className={KIT_LABEL}>Stage Execution</p>
              <Button
                variant="primary"
                className={`w-full ${KIT_PRIMARY}`}
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

          {/* v5.6: while running, the overview's run_state says whether to wait or to retry */}
          {round && isRunPlaying(round) && (
            <div data-testid="run-playing" role="status" className="flex flex-col gap-2">
              <p className={KIT_LABEL}>Matches playing…</p>
              <p className="font-label text-sm text-muted">Results move to review by themselves once every match is stored. Nothing to press.</p>
            </div>
          )}

          {round && can('retry') && (
            <div data-testid="run-failed" className="flex flex-col gap-3 border-l-2 border-alert pl-4">
              <p className={`${KIT_LABEL} ops-alert-text`}>Match run failed</p>
              <p role="alert" data-testid="run-error" className="font-label text-sm text-paper">
                {round.run_error ?? 'The server did not say why.'}
              </p>
              <p className="font-label text-sm text-muted">No results were saved. Retry plays every match again from the start.</p>
              <Button
                variant="primary"
                className={`w-full ${KIT_PRIMARY}`}
                disabled={!!busy}
                onClick={() =>
                  ask({
                    title: `Retry Round ${round.number}?`,
                    body: `Replay all of Round ${round.number}'s matches from the start.`,
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
            <div className="flex flex-col gap-2">
              <p className={KIT_LABEL}>Results Ready</p>
              <Button
                variant="primary"
                className={`w-full ${KIT_PRIMARY}`}
                disabled={!!busy}
                onClick={() => {
                  ask({
                    title: `Publish Round ${round.number}?`,
                    body: `Results go public, the top ${round.cut} advance and everyone else is eliminated.`,
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
                primary
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
                <p className="font-label text-sm text-muted">{rounds.isPending ? 'Loading the next round…' : `Round ${round.number + 1} is not waiting to open.`}</p>
              )
            ))}

          {isTournamentComplete(round) && <p className="text-center font-title text-2xl tracking-[0.1em] text-coop">Tournament complete</p>}

          {/* Mock-only: /__mock/reset exists only on the local mock server */}
          {USE_MOCK_API && (
            <div className="mt-auto border-t border-steel pt-6">
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
      </section>

      {/* Full width: the team ledger has six columns plus its buttons */}
      <div data-tour="ops-roster" className="lg:col-span-12">
        <Roster teams={overview.teams} round={overview.round} />
      </div>
    </div>
  )
}

/** A typed label on the order sheet (the dotted leader after it is in OrganiserConsole.css). */
const FIELD_LABEL = 'font-label text-xs tracking-[0.2em] text-type-muted uppercase'
/** A typed label in the control kit. */
const KIT_LABEL = 'font-label text-xs tracking-[0.2em] text-khaki uppercase'
/** Control buttons are typed, like the login and claim buttons. */
const KIT_BUTTON = 'py-3 !font-label !text-sm tracking-[0.2em]'
/** The one fire action: Special Elite has one weight, so a hairline stroke in the text colour makes it bolder. */
const KIT_PRIMARY = `${KIT_BUTTON} [-webkit-text-stroke:0.6px_currentColor]`

/** The status stamped on the order. Inks for paper (type-*), never fire or red. */
const STATUS_STAMP: Record<RoundStatus, { text: string; ink: string }> = {
  waiting: { text: 'Waiting', ink: 'text-type-muted' },
  open: { text: 'Window open', ink: 'text-type-ink' },
  running: { text: 'Running', ink: 'text-type-brass' },
  review: { text: 'In review', ink: 'text-type-ink' },
  published: { text: 'Published', ink: 'text-type-olive' },
}

/**
 * The cut on the order sheet, while it can still change: "Top [n] advance" with the number typed
 * on the line, and Save. The draft starts from the saved cut, and starts again whenever the saved
 * cut or the round changes (a poll brings in an edit made elsewhere). Save asks first (onSave).
 */
function CutField({
  round,
  disabled,
  busy,
  onSave,
}: {
  round: { id: number; number: number; status: RoundStatus; cut: number }
  disabled: boolean
  busy: boolean
  onSave: (cut: number) => void
}) {
  const [draft, setDraft] = useState(String(round.cut))
  useEffect(() => setDraft(String(round.cut)), [round.id, round.status, round.cut])
  const check = checkCut(draft)
  const unchanged = check.ok && check.cut === round.cut
  const id = `cut-round-${round.number}`
  return (
    <form
      className="flex flex-col items-end gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (check.ok && !unchanged && !disabled) onSave(check.cut)
      }}
    >
      {/* Wraps on a narrow sheet, so Save never runs off the paper */}
      <div className="flex flex-wrap items-baseline justify-end gap-2">
        <label htmlFor={id}>Top</label>
        <input
          id={id}
          inputMode="numeric"
          aria-label={`Round ${round.number} cut`}
          className={`${PAPER_FIELD} !w-14 text-center !text-lg font-bold`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={!check.ok}
          aria-describedby={check.ok ? undefined : `${id}-error`}
        />
        <span>advance</span>
        <Button type="submit" variant="ghost" className={`${ROW_BUTTON} !border-type-ink !text-type-ink hover:!bg-type-ink/10`} disabled={disabled || !check.ok || unchanged}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {!check.ok && (
        <p id={`${id}-error`} className="font-label text-sm text-type-red">
          {check.message}
        </p>
      )}
    </form>
  )
}

/** A minutes field and its button, for Open, Extend and Set time left. `primary` makes it the fire action (Open). */
function MinutesAction({
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
  busy,
  primary = false,
  onRun,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  error: string | null
  disabled: boolean
  busy: boolean
  primary?: boolean
  onRun: () => void
}) {
  const id = `minutes-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) onRun()
      }}
    >
      <label htmlFor={id} className={KIT_LABEL}>
        {hint}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          inputMode="numeric"
          className={`${inputClass} !w-24 !py-3 text-center !text-base`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button type="submit" variant={primary ? 'primary' : 'ghost'} className={`flex-1 ${primary ? KIT_PRIMARY : KIT_BUTTON}`} disabled={disabled}>
          {busy ? 'Sending…' : label}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="ops-alert-text font-label text-sm">
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

/**
 * Time left in the window: closes_at against server time (lib/clock), never this laptop's clock.
 * On a brass plate, the one thing the organiser reads first. Without a window it states the round's status,
 * or that the match run failed (v5.6), so "Matches are being played" never shows over a failed run.
 */
function ConsoleTimer({ status, closesAt, runFailed }: { status: RoundStatus; closesAt: number | null; runFailed: boolean }) {
  const now = useServerNow()
  const synced = useClock((s) => s.synced)
  const seconds = windowRemaining({ status, closesAt }, now)
  if (seconds === null) {
    return (
      <div className="ops-plate flex flex-col gap-2">
        <span className="font-label text-xs tracking-[0.2em] text-khaki uppercase">Round status</span>
        <p className="font-label text-2xl text-paper">{runFailed ? 'The match run failed' : WAITING[status]}</p>
      </div>
    )
  }
  const tone = seconds < 60 ? 'text-alert' : seconds < 300 ? 'text-amber' : 'text-paper'
  return (
    <div data-testid="console-timer" data-tour="ops-timer" className="ops-plate flex flex-col gap-2">
      <span className="font-label text-xs tracking-[0.2em] text-khaki uppercase">{seconds > 0 ? 'Window closes in' : 'Window closing'}</span>
      <p className={`font-data text-6xl leading-none font-bold tabular-nums ${tone}`}>{formatDuration(seconds)}</p>
      {!synced && <p className="font-label text-sm text-amber">Syncing with the server clock…</p>}
    </div>
  )
}
