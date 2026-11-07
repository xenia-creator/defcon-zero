/**
 * The organiser's team roster as pure logic, no React: labels, order, search and the
 * disqualify / restore rules (docs/api.md section 7). Ranks are never calculated here:
 * the order is only "sorted by score", and teams on the same score keep the server's order.
 */
import { errorMessage, hasCode } from '../../lib/api'
import type { AdminTeamRow, RoundStatus, TeamStatus } from '../../lib/contract'
import { UNREACHABLE } from './actions'

type Submission = AdminTeamRow['submission']

export type SubmissionTone = 'none' | 'checking' | 'accepted' | 'rejected'

/** "HH:MM:SS" (24-hour) for a server timestamp, in this browser's time zone unless one is given. */
export function formatTime(iso: string, timeZone?: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone }).format(ms)
}

/**
 * One line for a team's latest submission in the round.
 *   none                 "No submission"
 *   pending, running     "Checking…" (passed and total are 0 until the check finishes, so never "0 / 0")
 *   accepted, rejected   "accepted · v4 · passed 7 / 10 · 10:20:11". passed counts wins and draws against
 *                        the sample bots. Left out when total is 0: the code never ran (a syntax error).
 */
export function submissionLabel(submission: Submission, timeZone?: string): { text: string; tone: SubmissionTone } {
  if (!submission) return { text: 'No submission', tone: 'none' }
  if (submission.status === 'pending' || submission.status === 'running') return { text: 'Checking…', tone: 'checking' }
  const parts = [submission.status, `v${submission.version}`]
  if (submission.total > 0) parts.push(`passed ${submission.passed} / ${submission.total}`)
  const time = formatTime(submission.submitted_at, timeZone)
  if (time) parts.push(time)
  return { text: parts.join(' · '), tone: submission.status }
}

/** At most 2 decimals, trailing zeros dropped, no thousands separator: 3120, 3120.5, 1.33. */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '0'
  const rounded = Number(score.toFixed(2))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

type SortableTeam = Pick<AdminTeamRow, 'status' | 'score'>

/** Whether the roster is ordered by score: only once the round has results (review or published). */
export const sortsByScore = (roundStatus: RoundStatus) => roundStatus === 'review' || roundStatus === 'published'

/**
 * The roster's order. By score, highest first, in review or published; otherwise the server's
 * order (by username). Disqualified teams always go to the bottom. The sort is stable, so teams
 * on the same score keep the server's order: this is never a rank.
 */
export function sortTeams<T extends SortableTeam>(teams: readonly T[], roundStatus: RoundStatus): T[] {
  const byScore = sortsByScore(roundStatus)
  return [...teams].sort((a, b) => {
    const disqualified = Number(a.status === 'disqualified') - Number(b.status === 'disqualified')
    if (disqualified !== 0) return disqualified
    return byScore ? b.score - a.score : 0
  })
}

export const STATUS_FILTERS = ['all', 'active', 'eliminated', 'disqualified'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

type FilterableTeam = Pick<AdminTeamRow, 'status' | 'username' | 'nation_name'>

/** Teams whose nation or username contains the search (ignoring case and spaces at the ends), with the chosen status. */
export function filterTeams<T extends FilterableTeam>(teams: readonly T[], search: string, statusFilter: StatusFilter): T[] {
  const needle = search.trim().toLowerCase()
  return teams.filter(
    (t) =>
      (statusFilter === 'all' || t.status === statusFilter) &&
      (!needle || (t.nation_name ?? '').toLowerCase().includes(needle) || t.username.toLowerCase().includes(needle)),
  )
}

export type RowAction = 'disqualify' | 'restore'

/** Active teams can be disqualified and disqualified ones restored. Eliminated comes only from publish, never by hand. */
export function rowAction(status: TeamStatus): RowAction | null {
  if (status === 'active') return 'disqualify'
  if (status === 'disqualified') return 'restore'
  return null
}

/** The confirm for a row action: what it does to the team in this round (docs/api.md section 7). */
export function confirmText(action: RowAction, nation: string, roundStatus: RoundStatus): string {
  if (action === 'disqualify') {
    if (roundStatus === 'open') return `Disqualify ${nation}? They can't submit any more.`
    if (roundStatus === 'running' || roundStatus === 'review') return `Disqualify ${nation}? They drop to the bottom of this round and the next team moves into the cut.`
    return `Disqualify ${nation}?`
  }
  if (roundStatus === 'review') return `Restore ${nation}? The round is re-ranked and they get back the place they earned.`
  if (roundStatus === 'published') return `Restore ${nation}? This round's cut is already applied, so restoring makes them active for the next round.`
  return `Restore ${nation}? They become active again.`
}

/** What to show in a row when its PATCH fails. Branches on the error code, never the message. */
export function rowErrorMessage(err: unknown): string {
  if (hasCode(err, 'FORBIDDEN')) return 'Not an organiser'
  if (hasCode(err, 'NOT_FOUND')) return 'Team no longer exists, refresh'
  return errorMessage(err, UNREACHABLE)
}
