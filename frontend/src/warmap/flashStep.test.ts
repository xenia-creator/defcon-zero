import { describe, expect, it } from 'vitest'
import type { RoundStatus, StandingsNation } from './types'
import { finalResult } from './winner'
import { flashStep, isFinalPublished } from './flashStep'

const nation = (team_id: number, rank: number, territory_code: string, status: StandingsNation['status'] = 'active'): StandingsNation => ({
  team_id,
  nation_name: `Nation ${team_id}`,
  territory_code,
  status,
  score: 3000 - rank * 100,
  rank,
})
const round = (number: number, status: RoundStatus, id = number) => ({ id, number, status })
const standings = (round_id: number, round_status: RoundStatus, nations: StandingsNation[]) => ({ round_id, round_status, nations })
const finalNations = [nation(4, 1, 'AR'), nation(9, 2, 'JP'), nation(2, 3, 'IN', 'eliminated')]

const never = () => false
const always = () => true

describe('isFinalPublished', () => {
  it('is true only for the final round, published', () => {
    expect(isFinalPublished(round(3, 'published'))).toBe(true)
    expect(isFinalPublished(round(3, 'review'))).toBe(false)
    expect(isFinalPublished(round(2, 'published'))).toBe(false)
    expect(isFinalPublished(null)).toBe(false)
    expect(isFinalPublished(undefined)).toBe(false)
  })
})

describe('flashStep', () => {
  it('waits while the round is still loading', () => {
    expect(flashStep(undefined, null, never)).toEqual({ kind: 'wait' })
  })

  it('rearms before the final is published, and with no round at all', () => {
    expect(flashStep(null, null, always)).toEqual({ kind: 'rearm' })
    for (const status of ['waiting', 'open', 'running', 'review'] as const) {
      expect(flashStep(round(3, status), null, always)).toEqual({ kind: 'rearm' })
    }
    expect(flashStep(round(1, 'published'), null, always)).toEqual({ kind: 'rearm' })
  })

  it('plays on the publish transition, for the winner the live standings name', () => {
    const r = round(3, 'published')
    const final = finalResult(r, standings(3, 'published', finalNations))
    expect(final?.winner.territory_code).toBe('AR')
    expect(final?.runnerUp?.territory_code).toBe('JP')
    expect(flashStep(r, final, never)).toEqual({ kind: 'play', roundId: 3 })
  })

  it('waits, rather than playing, while the standings poll still holds the previous round', () => {
    const r = round(3, 'published')
    const lagging = finalResult(r, standings(3, 'review', finalNations))
    expect(lagging).toBeNull()
    expect(flashStep(r, lagging, never)).toEqual({ kind: 'wait' })
  })

  it('does not play twice in one tab (a reload)', () => {
    const r = round(3, 'published')
    const final = finalResult(r, standings(3, 'published', finalNations))
    expect(flashStep(r, final, (id) => id === 3)).toEqual({ kind: 'wait' })
  })

  it('a mark from an earlier final (another round id) does not stop this one', () => {
    const r = round(3, 'published', 23)
    const final = finalResult(r, standings(23, 'published', finalNations))
    expect(flashStep(r, final, (id) => id === 3)).toEqual({ kind: 'play', roundId: 23 })
  })

  it('never plays a result that belongs to another round', () => {
    const final = finalResult(round(3, 'published', 3), standings(3, 'published', finalNations))
    expect(flashStep(round(3, 'published', 30), final, never)).toEqual({ kind: 'wait' })
  })

  it('waits when the winner has fallen since publish (finalResult null)', () => {
    const r = round(3, 'published')
    const fallen = finalResult(r, standings(3, 'published', [{ ...finalNations[0], status: 'disqualified' }, ...finalNations.slice(1)]))
    expect(flashStep(r, fallen, never)).toEqual({ kind: 'wait' })
  })
})
