import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/api'
import { ROUND_STATUSES } from '../../lib/contract'
import {
  UNREACHABLE,
  actionErrorMessage,
  DEFAULT_EXTEND_MINUTES,
  DEFAULT_OPEN_MINUTES,
  FINAL_ROUND_NUMBER,
  TEAMS_KEPT_BY_ROUND_NUMBER,
  allowedActions,
  checkMinutes,
  cutFor,
  isTournamentComplete,
  nextRound,
} from './actions'

const kinds = (number: number, status: (typeof ROUND_STATUSES)[number]) => allowedActions({ number, status }).map((a) => a.kind)

describe('allowedActions follows the contract table', () => {
  it('waiting: Open only, 45 minutes by default', () => {
    expect(allowedActions({ number: 1, status: 'waiting' })).toEqual([{ kind: 'open', defaultMinutes: 45 }])
    expect(DEFAULT_OPEN_MINUTES).toBe(45)
  })

  it('open: Extend (10 minutes by default) and Start', () => {
    expect(allowedActions({ number: 1, status: 'open' })).toEqual([{ kind: 'extend', defaultMinutes: 10 }, { kind: 'start' }])
    expect(DEFAULT_EXTEND_MINUTES).toBe(10)
  })

  it('running: Retry only', () => {
    expect(kinds(2, 'running')).toEqual(['retry'])
  })

  it('review: Publish only', () => {
    expect(kinds(2, 'review')).toEqual(['publish'])
  })

  it('published before the last round: open the next round', () => {
    expect(allowedActions({ number: 1, status: 'published' })).toEqual([{ kind: 'open-next', defaultMinutes: 45 }])
    expect(kinds(2, 'published')).toEqual(['open-next'])
  })

  it('published last round: no actions, tournament complete', () => {
    expect(kinds(FINAL_ROUND_NUMBER, 'published')).toEqual([])
    expect(isTournamentComplete({ number: 3, status: 'published' })).toBe(true)
  })

  it('is complete only after round 3 is published', () => {
    for (const status of ROUND_STATUSES) {
      expect(isTournamentComplete({ number: 1, status })).toBe(false)
      expect(isTournamentComplete({ number: 2, status })).toBe(false)
      expect(isTournamentComplete({ number: 3, status })).toBe(status === 'published')
    }
    expect(isTournamentComplete(null)).toBe(false)
  })

  it('never offers a transition the contract does not allow', () => {
    const allowed: Record<string, string[]> = {
      waiting: ['open'],
      open: ['extend', 'start'],
      running: ['retry'],
      review: ['publish'],
      published: ['open-next'],
    }
    for (const number of [1, 2, 3]) {
      for (const status of ROUND_STATUSES) {
        for (const kind of kinds(number, status)) expect(allowed[status]).toContain(kind)
      }
    }
    // No re-opening an open, running, reviewed or published round
    for (const status of ['open', 'running', 'review', 'published'] as const) expect(kinds(1, status)).not.toContain('open')
  })

  it('no round, or a status it does not know: no actions', () => {
    expect(allowedActions(null)).toEqual([])
    expect(allowedActions(undefined)).toEqual([])
    expect(allowedActions({ number: 1, status: 'paused' as never })).toEqual([])
  })
})

describe('the cut', () => {
  it('keeps 15, then 8, then 2 (TEAMS_KEPT_BY_ROUND_NUMBER in backend/app/core/rounds.py)', () => {
    expect(TEAMS_KEPT_BY_ROUND_NUMBER).toEqual({ 1: 15, 2: 8, 3: 2 })
    expect(cutFor(1)).toBe(15)
    expect(cutFor(2)).toBe(8)
    expect(cutFor(3)).toBe(2)
  })

  it('has no cut for a round the contract does not have', () => {
    expect(cutFor(0)).toBeUndefined()
    expect(cutFor(4)).toBeUndefined()
  })
})

describe('nextRound', () => {
  const rounds = [
    { id: 11, number: 1, status: 'published' as const },
    { id: 12, number: 2, status: 'waiting' as const },
    { id: 13, number: 3, status: 'waiting' as const },
  ]

  it('finds the round numbered one higher that is still waiting, by its id', () => {
    expect(nextRound(rounds, { number: 1 })?.id).toBe(12)
    expect(nextRound(rounds, { number: 2 })?.id).toBe(13)
  })

  it('does not depend on the order GET /rounds lists them in', () => {
    expect(nextRound([...rounds].reverse(), { number: 1 })?.id).toBe(12)
  })

  it('has none after the last round', () => {
    expect(nextRound(rounds, { number: 3 })).toBeUndefined()
  })

  it('skips a next round that has already left waiting', () => {
    const opened = rounds.map((r) => (r.number === 2 ? { ...r, status: 'open' as const } : r))
    expect(nextRound(opened, { number: 1 })).toBeUndefined()
  })

  it('has none while the rounds are not loaded', () => {
    expect(nextRound(undefined, { number: 1 })).toBeUndefined()
    expect(nextRound(null, { number: 1 })).toBeUndefined()
    expect(nextRound([], { number: 1 })).toBeUndefined()
  })
})

describe('actionErrorMessage branches on the code, never the message', () => {
  const transition = new ApiError('INVALID_ROUND_TRANSITION', 'Round 1 is open, not waiting.', 409)

  it('INVALID_ROUND_TRANSITION: the round may have changed', () => {
    for (const kind of ['open', 'extend', 'start', 'publish', 'open-next'] as const) {
      expect(actionErrorMessage(kind, transition)).toBe("That action isn't allowed right now, the round may have changed.")
    }
  })

  it('INVALID_ROUND_TRANSITION on Retry: the matches are still playing', () => {
    expect(actionErrorMessage('retry', transition)).toBe('Matches are still playing. Retry only works after a failed run.')
  })

  it('VALIDATION_ERROR: the server message', () => {
    expect(actionErrorMessage('open', new ApiError('VALIDATION_ERROR', 'minutes must be a whole number from 1 to 240.', 400))).toBe(
      'minutes must be a whole number from 1 to 240.',
    )
  })

  it('anything else: the server message', () => {
    expect(actionErrorMessage('publish', new ApiError('FORBIDDEN', 'Organisers only.', 403))).toBe('Organisers only.')
    expect(actionErrorMessage('start', new ApiError('INTERNAL_ERROR', 'Something broke.', 500))).toBe('Something broke.')
  })

  it('a message that merely mentions a transition is not treated as one', () => {
    expect(actionErrorMessage('open', new ApiError('NOT_FOUND', 'INVALID_ROUND_TRANSITION', 404))).toBe('INVALID_ROUND_TRANSITION')
  })

  it('no server answer at all: a plain could-not-reach message', () => {
    expect(actionErrorMessage('open', new TypeError('Failed to fetch'))).toBe(UNREACHABLE)
  })
})

describe('checkMinutes', () => {
  it('accepts whole numbers from 1 to 240', () => {
    expect(checkMinutes('1')).toEqual({ ok: true, minutes: 1 })
    expect(checkMinutes('45')).toEqual({ ok: true, minutes: 45 })
    expect(checkMinutes('240')).toEqual({ ok: true, minutes: 240 })
    expect(checkMinutes(10)).toEqual({ ok: true, minutes: 10 })
    expect(checkMinutes(' 10 ')).toEqual({ ok: true, minutes: 10 })
  })

  it('rejects anything outside 1 to 240', () => {
    for (const bad of ['0', '241', '-5', 0, 241, '1000']) expect(checkMinutes(bad).ok).toBe(false)
  })

  it('rejects anything that is not a whole number', () => {
    for (const bad of ['', '  ', 'abc', '4.5', '1e2', '10m', '+10', 4.5, NaN]) expect(checkMinutes(bad).ok).toBe(false)
  })

  it('explains the range when it rejects', () => {
    const result = checkMinutes('0')
    expect(result).toEqual({ ok: false, message: 'Enter a whole number of minutes from 1 to 240.' })
  })
})
