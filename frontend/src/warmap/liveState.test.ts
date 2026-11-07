import { describe, expect, it } from 'vitest'
import { boardEmptyText, connection, liveNotice, type Read } from './liveState'

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

describe('war map empty leaderboard', () => {
  it('names why it is empty', () => {
    expect(boardEmptyText(null)).toBe('No round yet')
    expect(boardEmptyText({ number: 1, status: 'open' })).toBe('No published results yet')
    expect(boardEmptyText(undefined)).toBe('Awaiting signal')
  })
})
