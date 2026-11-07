import { Fragment, useRef, useState } from 'react'
import { Badge, Button, Empty, Panel, inputClass, useConfirm } from '../../components/ui'
import type { AdminTeamRow, RoundStatus } from '../../lib/contract'
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

const TONE: Record<SubmissionTone, string> = {
  none: 'text-muted',
  checking: 'text-amber',
  accepted: 'text-coop',
  rejected: 'text-alert',
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
    <Panel
      title={`Teams · Round ${round.number}`}
      right={
        <span className="mono text-xs text-muted" data-testid="roster-order">
          {sortsByScore(round.status) ? 'Sorted by score' : 'Sorted by username'}
        </span>
      }
    >
      {dialog}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search teams"
            placeholder="Search nation or username"
            className={`${inputClass} !w-auto min-w-0 flex-1`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select aria-label="Status filter" className={`${inputClass} !w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            {STATUS_FILTERS.map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </select>
          <span className="mono text-xs text-muted" data-testid="roster-count">
            {count}
          </span>
        </div>

        {teams.length === 0 ? (
          <Empty>No team has claimed a nation yet.</Empty>
        ) : shown.length === 0 ? (
          <Empty>No teams match.</Empty>
        ) : (
          <div className="overflow-x-auto border border-steel bg-ink/60">
            <table className="w-full text-left text-sm" aria-label="Teams">
              <thead className="label border-b border-steel">
                <tr>
                  <th scope="col" className="px-3 py-2 font-normal">Nation</th>
                  <th scope="col" className="px-3 py-2 font-normal">Territory</th>
                  <th scope="col" className="px-3 py-2 font-normal">Username</th>
                  <th scope="col" className="px-3 py-2 font-normal">Status</th>
                  <th scope="col" className="px-3 py-2 font-normal">Submission</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Score</th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel">
                {shown.map((t) => {
                  const submission = submissionLabel(t.submission)
                  const action = rowAction(t.status)
                  const busy = busyRows.has(t.team_id)
                  const error = rowErrors[t.team_id]
                  return (
                    <Fragment key={t.team_id}>
                      <tr data-testid="roster-row" className={t.status === 'active' ? '' : 'opacity-70'}>
                        <td className="px-3 py-2 font-bold tracking-wider uppercase">{t.nation_name}</td>
                        <td className="mono px-3 py-2 text-xs font-bold text-alert">{t.territory_code}</td>
                        <td className="mono px-3 py-2 text-xs text-muted">{t.username}</td>
                        <td className="px-3 py-2">
                          <Badge status={t.status} />
                        </td>
                        <td className={`mono px-3 py-2 text-xs whitespace-nowrap ${TONE[submission.tone]}`}>{submission.text}</td>
                        <td className="mono px-3 py-2 text-right tabular-nums">{formatScore(t.score)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {action && (
                            <Button variant={ROW_ACTION[action].variant} className="!px-3 !py-1.5 !text-[10px]" disabled={busy} onClick={() => confirm(t, action)}>
                              {busy ? 'Sending…' : ROW_ACTION[action].label}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {error && (
                        <tr data-testid="row-error">
                          <td colSpan={COLUMNS} role="alert" className="px-3 pb-2 text-right text-xs text-alert">
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
      </div>
    </Panel>
  )
}

/** Team accounts that haven't claimed a territory yet. They have no team id, so there's nothing to do to them here. */
export function UnclaimedPanel({ usernames }: { usernames: readonly string[] }) {
  const n = usernames.length
  return (
    <Panel title="Unclaimed Accounts">
      <div data-testid="unclaimed" className="space-y-2 text-sm">
        <p className={n === 0 ? 'text-coop' : 'text-amber'}>{n === 0 ? 'All accounts claimed' : `${n} ${n === 1 ? 'account' : 'accounts'} not claimed`}</p>
        {n > 0 && (
          <ul className="mono flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Unclaimed accounts">
            {usernames.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
