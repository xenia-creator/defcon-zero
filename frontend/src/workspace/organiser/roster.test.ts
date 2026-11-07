import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/api'
import { ROUND_STATUSES, type AdminTeamRow, type TeamStatus } from '../../lib/contract'
import { confirmText, filterTeams, formatScore, formatTime, rowAction, rowErrorMessage, sortTeams, sortsByScore, submissionLabel } from './roster'

const sub = (change: Partial<NonNullable<AdminTeamRow['submission']>> = {}): NonNullable<AdminTeamRow['submission']> => ({
  version: 4,
  status: 'accepted',
  passed: 7,
  total: 10,
  submitted_at: '2026-11-12T10:20:11Z',
  ...change,
})

const team = (username: string, change: Partial<AdminTeamRow> = {}): AdminTeamRow => ({
  team_id: username.length,
  username,
  nation_name: `Nation ${username}`,
  territory_code: 'RU',
  status: 'active',
  is_bot: false,
  submission: null,
  score: 0,
  ...change,
})

describe('submissionLabel', () => {
  it('no submission', () => {
    expect(submissionLabel(null)).toEqual({ text: 'No submission', tone: 'none' })
  })

  it('pending and running: "Checking…", never "0 / 0"', () => {
    for (const status of ['pending', 'running'] as const) {
      const label = submissionLabel(sub({ status, passed: 0, total: 0 }), 'UTC')
      expect(label).toEqual({ text: 'Checking…', tone: 'checking' })
      expect(label.text).not.toContain('0 / 0')
    }
  })

  it('accepted: status, version, passed / total and the time', () => {
    expect(submissionLabel(sub(), 'UTC')).toEqual({ text: 'accepted · v4 · passed 7 / 10 · 10:20:11', tone: 'accepted' })
  })

  it('rejected after running: the same, with its test results', () => {
    expect(submissionLabel(sub({ status: 'rejected', version: 2, passed: 3, total: 10 }), 'UTC')).toEqual({
      text: 'rejected · v2 · passed 3 / 10 · 10:20:11',
      tone: 'rejected',
    })
  })

  it('rejected before running (total 0): no passed part', () => {
    expect(submissionLabel(sub({ status: 'rejected', passed: 0, total: 0 }), 'UTC').text).toBe('rejected · v4 · 10:20:11')
  })

  it('an unreadable time is left out', () => {
    expect(submissionLabel(sub({ submitted_at: 'not a date' }), 'UTC').text).toBe('accepted · v4 · passed 7 / 10')
  })
})

describe('formatTime', () => {
  it('24-hour HH:MM:SS in the given time zone', () => {
    expect(formatTime('2026-11-12T22:05:09Z', 'UTC')).toBe('22:05:09')
    expect(formatTime('2026-11-12T22:05:09Z', 'Asia/Kolkata')).toBe('03:35:09')
  })

  it('null for an unreadable time', () => {
    expect(formatTime('', 'UTC')).toBeNull()
  })
})

describe('formatScore', () => {
  it('at most 2 decimals, trailing zeros dropped, no separators', () => {
    expect(formatScore(3120)).toBe('3120')
    expect(formatScore(3120.0)).toBe('3120')
    expect(formatScore(3120.5)).toBe('3120.5')
    expect(formatScore(1.333333)).toBe('1.33')
    expect(formatScore(2.675)).toBe('2.67') // 2.675 is stored as 2.67499…, as everywhere in JS
    expect(formatScore(0.005)).toBe('0.01')
    expect(formatScore(12345.678)).toBe('12345.68')
    expect(formatScore(0)).toBe('0')
  })

  it('never "-0", and something sane for a non-number', () => {
    expect(formatScore(-0.001)).toBe('0')
    expect(formatScore(NaN)).toBe('0')
    expect(formatScore(-12.5)).toBe('-12.5')
  })
})

describe('sortTeams', () => {
  // Server order: by username
  const teams = [
    team('alpha', { score: 10 }),
    team('bravo', { score: 30, status: 'disqualified' }),
    team('charlie', { score: 20 }),
    team('delta', { score: 20, status: 'eliminated' }),
    team('echo', { score: 40 }),
  ]
  const names = (list: AdminTeamRow[]) => list.map((t) => t.username)

  it('by score, highest first, in review and published', () => {
    for (const status of ['review', 'published'] as const) {
      expect(sortsByScore(status)).toBe(true)
      expect(names(sortTeams(teams, status))).toEqual(['echo', 'charlie', 'delta', 'alpha', 'bravo'])
    }
  })

  it('server order in waiting, open and running', () => {
    for (const status of ['waiting', 'open', 'running'] as const) {
      expect(sortsByScore(status)).toBe(false)
      expect(names(sortTeams(teams, status))).toEqual(['alpha', 'charlie', 'delta', 'echo', 'bravo'])
    }
  })

  it('disqualified always at the bottom, even with the top score', () => {
    for (const status of ROUND_STATUSES) expect(names(sortTeams(teams, status)).at(-1)).toBe('bravo')
  })

  it('teams on the same score keep the server order (never a rank)', () => {
    const tied = [team('a', { score: 5 }), team('b', { score: 5 }), team('c', { score: 5 })]
    expect(names(sortTeams(tied, 'review'))).toEqual(['a', 'b', 'c'])
  })

  it('does not change the list it was given', () => {
    const copy = [...teams]
    sortTeams(teams, 'review')
    expect(teams).toEqual(copy)
  })
})

describe('filterTeams', () => {
  const teams = [
    team('team_kremlin', { nation_name: 'Red Dawn' }),
    team('team_nautilus', { nation_name: 'Blue Tide', status: 'eliminated' }),
    team('team_falcon', { nation_name: 'Golden Falcon', status: 'disqualified' }),
  ]
  const names = (list: AdminTeamRow[]) => list.map((t) => t.username)

  it('an empty search and "all" keep everyone', () => {
    expect(names(filterTeams(teams, '', 'all'))).toEqual(['team_kremlin', 'team_nautilus', 'team_falcon'])
    expect(names(filterTeams(teams, '   ', 'all'))).toHaveLength(3)
  })

  it('search matches the nation or the username, ignoring case', () => {
    expect(names(filterTeams(teams, 'red dawn', 'all'))).toEqual(['team_kremlin'])
    expect(names(filterTeams(teams, 'NAUTILUS', 'all'))).toEqual(['team_nautilus'])
    expect(names(filterTeams(teams, ' falc ', 'all'))).toEqual(['team_falcon'])
    expect(names(filterTeams(teams, 'zzz', 'all'))).toEqual([])
  })

  it('filters by each status', () => {
    expect(names(filterTeams(teams, '', 'active'))).toEqual(['team_kremlin'])
    expect(names(filterTeams(teams, '', 'eliminated'))).toEqual(['team_nautilus'])
    expect(names(filterTeams(teams, '', 'disqualified'))).toEqual(['team_falcon'])
  })

  it('search and filter together', () => {
    expect(names(filterTeams(teams, 'team_', 'eliminated'))).toEqual(['team_nautilus'])
    expect(names(filterTeams(teams, 'red', 'eliminated'))).toEqual([])
  })
})

describe('rowAction', () => {
  it('active: Disqualify, disqualified: Restore, eliminated: nothing', () => {
    const expected: Record<TeamStatus, string | null> = { active: 'disqualify', disqualified: 'restore', eliminated: null }
    for (const [status, action] of Object.entries(expected)) expect(rowAction(status as TeamStatus)).toBe(action)
  })
})

describe('confirmText', () => {
  it('Disqualify, by round status', () => {
    expect(confirmText('disqualify', 'Red Dawn', 'open')).toBe("Disqualify Red Dawn? They can't submit any more.")
    for (const status of ['running', 'review'] as const) {
      expect(confirmText('disqualify', 'Red Dawn', status)).toBe('Disqualify Red Dawn? They drop to the bottom of this round and the next team moves into the cut.')
    }
    for (const status of ['waiting', 'published'] as const) expect(confirmText('disqualify', 'Red Dawn', status)).toBe('Disqualify Red Dawn?')
  })

  it('Restore, by round status', () => {
    expect(confirmText('restore', 'Red Dawn', 'review')).toBe('Restore Red Dawn? The round is re-ranked and they get back the place they earned.')
    expect(confirmText('restore', 'Red Dawn', 'published')).toBe(
      "Restore Red Dawn? This round's cut is already applied, so restoring makes them active for the next round.",
    )
    for (const status of ['waiting', 'open', 'running'] as const) expect(confirmText('restore', 'Red Dawn', status)).toBe('Restore Red Dawn? They become active again.')
  })
})

describe('rowErrorMessage branches on the code, never the message', () => {
  it('FORBIDDEN and NOT_FOUND get their own text', () => {
    expect(rowErrorMessage(new ApiError('FORBIDDEN', 'Organisers only.', 403))).toBe('Not an organiser')
    expect(rowErrorMessage(new ApiError('NOT_FOUND', 'This team does not exist.', 404))).toBe('Team no longer exists, refresh')
  })

  it('anything else: the server message', () => {
    expect(rowErrorMessage(new ApiError('VALIDATION_ERROR', 'status must be active, eliminated or disqualified.', 400))).toBe(
      'status must be active, eliminated or disqualified.',
    )
    expect(rowErrorMessage(new ApiError('INTERNAL_ERROR', 'Something broke.', 500))).toBe('Something broke.')
  })

  it('a message that merely mentions a code is not treated as one', () => {
    expect(rowErrorMessage(new ApiError('INTERNAL_ERROR', 'FORBIDDEN', 500))).toBe('FORBIDDEN')
  })

  it('no answer: could not reach the server', () => {
    expect(rowErrorMessage(new TypeError('Failed to fetch'))).toBe('Could not reach the server. Try again in a moment.')
  })
})
