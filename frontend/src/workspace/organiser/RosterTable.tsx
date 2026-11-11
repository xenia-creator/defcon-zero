import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Stamp } from '../../components/period'
import { Button, useConfirm } from '../../components/ui'
import type { AdminTeamRow, RoundStatus, TeamStatus } from '../../lib/contract'
import { useLive } from '../../lib/live'
import { admin, useRefreshAfterAdmin } from '../../lib/queries'
import {
  STATUS_FILTERS,
  confirmText,
  filterTeams,
  formatScore,
  rowAction,
  rowErrorMessage,
  sortTeams,
  sortsByScore,
  submissionLabel,
  type RowAction,
  type StatusFilter,
  type SubmissionTone,
} from './roster'

/** Submission inks on the paper ledger: a rejected bot is the only red. */
const TONE: Record<SubmissionTone, string> = {
  none: 'text-type-muted',
  checking: 'text-type-brass',
  accepted: 'text-type-olive',
  rejected: 'text-type-red',
}

/** Status in the ledger: active is plain typed olive; the exceptions are stamped, faded red only for disqualified. */
const STATUS_INK: Record<TeamStatus, string> = {
  active: 'text-type-olive',
  eliminated: 'text-type-muted',
  disqualified: 'text-type-red',
}

/** A ledger line by status: eliminated fades to muted ink, disqualified gets a red wash. */
const ROW_CLASS: Record<TeamStatus, string> = {
  active: '',
  eliminated: 'ops-ledger__row--out',
  disqualified: 'ops-ledger__row--struck',
}

/** A disqualified nation is struck off the roll in red ink; an eliminated one is typed in muted ink. */
const NATION_CLASS: Record<TeamStatus, string> = {
  active: '',
  eliminated: 'text-type-muted',
  disqualified: 'line-through decoration-type-red decoration-2',
}

/** A typed line on the sheet, as on the login form: mono for what is typed, the placeholder typed. Also the order sheet's cut field. */
export const PAPER_FIELD =
  'paper-input !bg-transparent !px-0 !font-data placeholder:font-label focus:!border-type-ink focus:!shadow-[0_2px_0_0_var(--color-type-ink)]'

/** Row buttons, restyled for paper: small and outlined, Disqualify in type-red, Restore in ink. Also the cut's Save. */
export const ROW_BUTTON = '!px-4 !py-1 !font-label !text-xs !font-normal tracking-[0.16em] !bg-transparent'
const PAPER_ROW_ACTION: Record<RowAction, string> = {
  disqualify: '!border-type-red !text-type-red hover:!bg-type-red/10',
  restore: '!border-type-ink !text-type-ink hover:!bg-type-ink/10',
}

const FILTER_LABEL: Record<StatusFilter, string> = { all: 'All', active: 'Active', eliminated: 'Eliminated', disqualified: 'Disqualified' }

/** Each row action and the status it sends to PATCH /admin/teams/{id}. */
const ROW_ACTION = {
  disqualify: { label: 'Disqualify', sends: 'disqualified', done: 'Disqualified', variant: 'danger' },
  restore: { label: 'Restore', sends: 'active', done: 'Restored', variant: 'ghost' },
} as const satisfies Record<RowAction, unknown>

const COLUMNS = 7

const plural = (n: number) => `${n} ${n === 1 ? 'team' : 'teams'}`

/** teams[] holds only claimed teams, so the nation is always set; the username is a safe fallback for the type. */
const nationOf = (t: AdminTeamRow) => t.nation_name ?? t.username

/**
 * Every claimed team in the overview's round, as a table, with disqualify and restore.
 * The order comes from sortTeams: by score once the round has results, never a rank,
 * which only the server decides.
 */
export function Roster({ teams, round }: { teams: readonly AdminTeamRow[]; round: { number: number; status: RoundStatus } }) {
  const toast = useLive((s) => s.toast)
  const refresh = useRefreshAfterAdmin()
  const { ask, dialog } = useConfirm()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  /** Rows with a request in flight: state to disable their buttons, a ref so a second click before the re-render sends nothing. */
  const [busyRows, setBusyRows] = useState<ReadonlySet<number>>(new Set())
  const inFlight = useRef(new Set<number>())
  /** Each row's last error, until that row's next success. */
  const [rowErrors, setRowErrors] = useState<Readonly<Record<number, string>>>({})

  const shown = sortTeams(filterTeams(teams, search, statusFilter), round.status)
  const filtered = search.trim() !== '' || statusFilter !== 'all'
  const count = filtered ? `${shown.length} of ${plural(teams.length)}` : plural(teams.length)

  const setRowError = (teamId: number, message: string | null) =>
    setRowErrors((errors) => {
      const next = { ...errors }
      if (message === null) delete next[teamId]
      else next[teamId] = message
      return next
    })

  /** PATCH one team, then refetch everything it can change, whether it worked or not. */
  async function act(team: AdminTeamRow, action: RowAction) {
    const id = team.team_id
    if (inFlight.current.has(id)) return
    inFlight.current.add(id)
    setBusyRows(new Set(inFlight.current))
    const { sends, done } = ROW_ACTION[action]
    try {
      await admin.setTeamStatus(id, sends)
      toast('good', `${done} ${nationOf(team)}`)
      setRowError(id, null)
    } catch (err) {
      const message = rowErrorMessage(err)
      toast('bad', `${nationOf(team)}: ${message}`)
      setRowError(id, message)
    } finally {
      await refresh()
      inFlight.current.delete(id)
      setBusyRows(new Set(inFlight.current))
    }
  }

  function confirm(team: AdminTeamRow, action: RowAction) {
    const { label } = ROW_ACTION[action]
    ask({
      title: `${label} team`,
      body: confirmText(action, nationOf(team), round.status),
      confirmLabel: label,
      run: () => void act(team, action),
    })
  }

  return (
    <section className="paper-sheet ops-sheet relative flex flex-col gap-6 p-6 sm:p-8" aria-labelledby="ops-ledger-title">
      {dialog}
      <header className="flex flex-col gap-2 border-b border-type-muted pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">Field ledger · Nominal roll</p>
          <span className="font-data text-sm text-type-muted" data-testid="roster-order">
            {sortsByScore(round.status) ? 'Sorted by score' : 'Sorted by username'}
          </span>
        </div>
        <h2 id="ops-ledger-title" className="font-title text-2xl tracking-[0.06em]">
          Teams · Round {round.number}
        </h2>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <input
          type="search"
          aria-label="Search teams"
          placeholder="Search nation or username"
          className={`${PAPER_FIELD} min-w-0 flex-1`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Status filter" className={`${PAPER_FIELD} ops-select !w-auto !font-label`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          {STATUS_FILTERS.map((f) => (
            <option key={f} value={f}>
              {FILTER_LABEL[f]}
            </option>
          ))}
        </select>
        <span className="pb-2 font-data text-sm text-type-muted" data-testid="roster-count">
          {count}
        </span>
      </div>

      {teams.length === 0 ? (
        <PaperEmpty>No team has claimed a nation yet.</PaperEmpty>
      ) : shown.length === 0 ? (
        <PaperEmpty>No teams match.</PaperEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="ops-ledger w-full text-left" aria-label="Teams">
            <thead>
              <tr className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">
                <th scope="col" className="px-2 py-2 font-normal">Nation</th>
                <th scope="col" className="px-2 py-2 font-normal">Territory</th>
                <th scope="col" className="px-2 py-2 font-normal">Username</th>
                <th scope="col" className="px-2 py-2 font-normal">Status</th>
                <th scope="col" className="px-2 py-2 font-normal">Submission</th>
                <th scope="col" className="px-2 py-2 text-right font-normal">Score</th>
                <th scope="col" className="px-2 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const submission = submissionLabel(t.submission)
                const action = rowAction(t.status)
                const busy = busyRows.has(t.team_id)
                const error = rowErrors[t.team_id]
                return (
                  <Fragment key={t.team_id}>
                    <tr data-testid="roster-row" className={ROW_CLASS[t.status]}>
                      <td className={`px-2 py-2 font-label text-base ${NATION_CLASS[t.status]}`}>{t.nation_name}</td>
                      <td className="px-2 py-2 font-data text-sm font-bold">{t.territory_code}</td>
                      <td className="px-2 py-2 font-data text-sm text-type-muted">{t.username}</td>
                      <td className="px-2 py-2">
                        {t.status === 'active' ? (
                          <span className="font-label text-sm tracking-[0.14em] text-type-olive uppercase">{t.status}</span>
                        ) : (
                          <Stamp tilt={-3} className={`ops-stamp-sm whitespace-nowrap ${STATUS_INK[t.status]}`}>
                            {t.status}
                          </Stamp>
                        )}
                      </td>
                      <td className={`px-2 py-2 font-data text-xs whitespace-nowrap ${TONE[submission.tone]}`}>{submission.text}</td>
                      <td className="px-2 py-2 text-right font-data text-base font-bold">{formatScore(t.score)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {action && (
                          <Button variant={ROW_ACTION[action].variant} className={`${ROW_BUTTON} ${PAPER_ROW_ACTION[action]}`} disabled={busy} onClick={() => confirm(t, action)}>
                            {busy ? 'Sending…' : ROW_ACTION[action].label}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {error && (
                      <tr data-testid="row-error" className="ops-ledger__error">
                        <td colSpan={COLUMNS} role="alert" className="px-2 pb-2 text-right font-label text-sm text-type-red">
                          {nationOf(t)}: {error}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** An empty ledger, typed on the sheet (the shared Empty is for dark panels). */
function PaperEmpty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center font-label text-sm text-type-muted">{children}</p>
}

/**
 * Team accounts that haven't claimed a territory yet: a typed field report at the foot of the order.
 * They have no team id, so there's nothing to do to them here.
 */
export function UnclaimedPanel({ usernames }: { usernames: readonly string[] }) {
  const n = usernames.length
  return (
    <section aria-labelledby="ops-unclaimed-title" className="flex flex-col gap-2">
      <h3 id="ops-unclaimed-title" className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">
        Field report · Unclaimed accounts
      </h3>
      <div data-testid="unclaimed" className="flex flex-col gap-2">
        <p className={`font-label text-base ${n === 0 ? 'text-type-olive' : 'text-type-brass'}`}>{n === 0 ? 'All accounts claimed' : `${n} ${n === 1 ? 'account' : 'accounts'} not claimed`}</p>
        {n > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 font-data text-sm" aria-label="Unclaimed accounts">
            {usernames.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
