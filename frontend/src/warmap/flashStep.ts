// When the app-level winner flash (WinnerFlash.tsx) plays. Pure, so every case is unit-tested.
// What it shows is finalResult (winner.ts), unchanged: this only decides when.
import { ROUNDS } from '../lib/rounds'
import type { RoundStatus } from './types'
import type { FinalResult } from './winner'

/** The last round: once it is published, its rank 1 is the winner and rank 2 the runner-up (api.md §4). */
const FINAL_ROUND = ROUNDS.length

type CurrentRound = { id: number; number: number; status: RoundStatus }

/** The final round is the current one and published: the only time GET /standings can hold the result. */
export const isFinalPublished = (round: CurrentRound | null | undefined): round is CurrentRound =>
  !!round && round.number >= FINAL_ROUND && round.status === 'published'

export type FlashStep =
  /** Show the flash for this final now. */
  | { kind: 'play'; roundId: number }
  /** The tournament is not over (or was reset): forget what this tab has shown, so the next final plays. */
  | { kind: 'rearm' }
  /** Nothing to do yet: still loading, the two reads haven't agreed yet, or this tab has shown it already. */
  | { kind: 'wait' }

/**
 * What the flash should do now.
 * - `round` is GET /rounds/current: undefined while it loads, null before any round has started (404).
 * - `final` is finalResult over the same round and GET /standings. It is null until both reads name
 *   the same published final round, so a standings poll that lags the round poll only delays the
 *   flash, never shows an older round's leader.
 * - `shown` says whether this browser tab has already shown the flash for that round (sessionStorage).
 *
 * It plays once per tab: on the publish itself for whoever is watching, and on a later tab or login
 * (latecomers), but not again on a reload. Whenever the current round is anything other than the
 * published final (for instance after an event reset, when the same round ids come back as
 * waiting), it rearms, so a tab left open from a dry run still plays at the real event.
 */
export function flashStep(
  round: CurrentRound | null | undefined,
  final: FinalResult | null,
  shown: (roundId: number) => boolean,
): FlashStep {
  if (round === undefined) return { kind: 'wait' }
  if (!isFinalPublished(round)) return { kind: 'rearm' }
  if (!final || final.roundId !== round.id || shown(final.roundId)) return { kind: 'wait' }
  return { kind: 'play', roundId: final.roundId }
}

// Per tab, so a reload doesn't flash again but a new tab does. Nothing in localStorage, so no key
// from a rehearsal outlives the tab.
const PREFIX = 'dz.winner-flash.'
const flashKey = (roundId: number) => `${PREFIX}${roundId}`
// Used when sessionStorage is blocked, so the flash still plays only once per page load
const shownInMemory = new Set<number>()

export function shownInTab(roundId: number): boolean {
  if (shownInMemory.has(roundId)) return true
  try {
    return sessionStorage.getItem(flashKey(roundId)) !== null
  } catch {
    return false
  }
}

export function markShownInTab(roundId: number): void {
  shownInMemory.add(roundId)
  try {
    sessionStorage.setItem(flashKey(roundId), '1')
  } catch {
    // memory is enough
  }
}

export function rearmTab(): void {
  shownInMemory.clear()
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key)
  } catch {
    // nothing stored
  }
}
