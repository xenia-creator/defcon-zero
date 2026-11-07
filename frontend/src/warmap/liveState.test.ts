import { describe, expect, it } from 'vitest'
import { boardHeading, boardState, connection, liveNotice, type Read } from './liveState'

// A react-query read, as the three war map hooks return it. 404s are already null (lib/queries).
const ok = (data: unknown = {}): Read => ({ data, isError: false, isFetching: false, errorUpdatedAt: 0 })
const loading: Read = { data: undefined, isError: false, isFetching: true, errorUpdatedAt: 0 }
const failedCold: Read = { data: undefined, isError: true, isFetching: false, errorUpdatedAt: 1 }
// react-query v5 puts a no-data query back to pending (isError false) while it refetches
const failedColdRefetching: Read = { data: undefined, isError: false, isFetching: true, errorUpdatedAt: 1 }
const failedWarm: Read = { data: {}, isError: true, isFetching: false, errorUpdatedAt: 1 }

describe('war map connection state', () => {
  it('is ok when every read has data', () => {
    expect(connection([ok(), ok(), ok()])).toBe('ok')
  })

  it('treats a 404 (null) as data, never as an error: "no round yet" is not a fault', () => {
    expect(connection([ok(null), ok(null), ok()])).toBe('ok')
  })

  it('is connecting while a first load is still in flight', () => {
    expect(connection([loading, ok(), ok()])).toBe('connecting')
  })

  it('is a fault only on a cold start, when a read has never succeeded', () => {
    expect(connection([failedCold, ok(), ok()])).toBe('fault')
    expect(connection([failedCold, loading, loading])).toBe('fault')
  })

  it('stays a fault while a failed cold read is retrying, so the error screen does not flicker', () => {
    expect(connection([failedColdRefetching, ok(), ok()])).toBe('fault')
  })

  it('recovers once the failed read finally has data', () => {
    expect(connection([{ ...failedWarm, isError: false }, ok(), ok()])).toBe('ok')
  })

  it('keeps the last good data and is only degraded when a later poll fails', () => {
    expect(connection([failedWarm, ok(), ok()])).toBe('degraded')
  })
})

describe('war map notice', () => {
  const round = (status: 'waiting' | 'open' | 'running' | 'review' | 'published') => ({ number: 2, status })

  it('says it is connecting on first load', () => {
    expect(liveNotice({ conn: 'connecting', round: undefined, ranked: 0 })?.title).toBe('Establishing uplink')
  })

  it('shows standby before any round has started (GET /rounds/current 404)', () => {
    expect(liveNotice({ conn: 'ok', round: null, ranked: 0 })).toMatchObject({ tone: 'standby', title: 'Standby · no round yet' })
  })

  it('shows the round in progress while nothing is published', () => {
    expect(liveNotice({ conn: 'ok', round: round('open'), ranked: 0 })).toMatchObject({ tone: 'progress', title: 'Round in progress' })
    expect(liveNotice({ conn: 'ok', round: round('running'), ranked: 0 })).toMatchObject({ tone: 'progress', title: 'Round in progress' })
    expect(liveNotice({ conn: 'ok', round: round('review'), ranked: 0 })?.title).toBe('Results under review')
    expect(liveNotice({ conn: 'ok', round: round('waiting'), ranked: 0 })?.title).toBe('Round 2 standing by')
  })

  it('gets out of the way once there are published results', () => {
    expect(liveNotice({ conn: 'ok', round: round('open'), ranked: 8 })).toBeNull()
    expect(liveNotice({ conn: 'ok', round: round('published'), ranked: 0 })).toBeNull()
  })

  it('still shows the state while a poll is failing (degraded keeps the last data)', () => {
    expect(liveNotice({ conn: 'degraded', round: null, ranked: 0 })?.title).toBe('Standby · no round yet')
  })
})

describe('public leaderboard state', () => {
  it('awaits, and names why, when there is nothing published', () => {
    expect(boardState(undefined, 0)).toMatchObject({ kind: 'awaiting', title: 'Awaiting signal' })
    expect(boardState(null, 0)).toMatchObject({ kind: 'awaiting', title: 'No round yet' })
    for (const status of ['waiting', 'open', 'running', 'review'] as const) {
      expect(boardState({ number: 1, status }, 0)).toMatchObject({ kind: 'awaiting', title: 'Awaiting results' })
    }
    expect(boardState({ number: 1, status: 'running' }, 0)).toMatchObject({ detail: expect.stringContaining('Round 1 in progress') })
    expect(boardState({ number: 1, status: 'review' }, 0)).toMatchObject({ detail: expect.stringContaining('under review') })
  })

  it('shows the current round once it is published', () => {
    expect(boardState({ number: 1, status: 'published' }, 12)).toEqual({ kind: 'results', resultsRound: 1, current: { number: 1, status: 'published' } })
  })

  it('passes only the round number and status through, whatever else the round carries', () => {
    const round = { number: 2, status: 'open' as const, game: 'theatre_of_war' }
    expect(boardState(round, 15)).toEqual({ kind: 'results', resultsRound: 1, current: { number: 2, status: 'open' } })
  })

  it('keeps the previous round while a newer one is not yet published', () => {
    for (const status of ['waiting', 'open', 'running', 'review'] as const) {
      expect(boardState({ number: 2, status }, 15)).toMatchObject({ kind: 'results', resultsRound: 1, current: { number: 2, status } })
    }
  })
})

describe('public leaderboard heading', () => {
  const results = (resultsRound: number, number: number, status: 'waiting' | 'open' | 'running' | 'review' | 'published') =>
    ({ kind: 'results', resultsRound, current: { number, status } }) as const

  it('names the round and game the results come from, as final', () => {
    expect(boardHeading(results(1, 1, 'published'))).toEqual({ title: "Round 1 · The Prisoner's Dilemma — Final", sub: null })
    expect(boardHeading(results(2, 2, 'published')).title).toBe('Round 2 · Theatre of War — Final')
  })

  it("reads as the previous round's results while a newer round is under way", () => {
    expect(boardHeading(results(1, 2, 'running'))).toEqual({
      title: "Round 1 · The Prisoner's Dilemma — Final",
      sub: 'Round 2 in progress · results pending',
    })
    expect(boardHeading(results(1, 2, 'open')).sub).toBe('Round 2 in progress · results pending')
    expect(boardHeading(results(2, 3, 'review')).sub).toBe('Round 3 under review · results pending')
    expect(boardHeading(results(2, 3, 'waiting')).sub).toBe('Round 3 standing by · results pending')
  })

  it('says the tournament is complete once round 3 is published', () => {
    expect(boardHeading(results(3, 3, 'published'))).toEqual({ title: 'Round 3 · Foreign Aid — Final', sub: 'Tournament complete' })
  })

  it('never calls a round final before it is published (scripted showcase only)', () => {
    expect(boardHeading(results(1, 1, 'running')).title).toBe("Round 1 · The Prisoner's Dilemma — Provisional")
  })

  it('still labels a round this client has no name for', () => {
    expect(boardHeading(results(4, 5, 'open'))).toEqual({ title: 'Round 4 — Final', sub: 'Round 5 in progress · results pending' })
  })
})
