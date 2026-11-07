/**
 * Which organiser actions a round allows, straight from the table in docs/api.md section 4.
 * Pure logic, no React: the console shows exactly these buttons and nothing else. The server
 * still has the final say and answers anything else with 409 INVALID_ROUND_TRANSITION.
 *
 *   waiting    Open (minutes)
 *   open       Extend (minutes), Start
 *   running    Retry
 *   review     Publish
 *   published  Open the next round, or "Tournament complete" after the last one
 */
import { errorMessage, hasCode } from '../../lib/api'
import { MAX_WINDOW_MINUTES, MIN_WINDOW_MINUTES, type RoundStatus } from '../../lib/contract'

/** Minutes the inputs start at. */
export const DEFAULT_OPEN_MINUTES = 45
export const DEFAULT_EXTEND_MINUTES = 10

/**
 * How many teams each round keeps at publish (docs/api.md section 4).
 * Must match TEAMS_KEPT_BY_ROUND_NUMBER in backend/app/core/rounds.py.
 */
export const TEAMS_KEPT_BY_ROUND_NUMBER: Readonly<Record<number, number>> = { 1: 15, 2: 8, 3: 2 }

/** The last round: publishing it ends the tournament. */
export const FINAL_ROUND_NUMBER = 3

/** The top N kept when this round is published, or undefined for a round number the contract doesn't have. */
export const cutFor = (roundNumber: number): number | undefined => TEAMS_KEPT_BY_ROUND_NUMBER[roundNumber]

export type RoundAction =
  | { kind: 'open'; defaultMinutes: number }
  | { kind: 'extend'; defaultMinutes: number }
  | { kind: 'start' }
  | { kind: 'retry' }
  | { kind: 'publish' }
  /** Open the round after this one; its id comes from GET /rounds. */
  | { kind: 'open-next'; defaultMinutes: number }

export type RoundActionKind = RoundAction['kind']

/** The round as the console knows it: only what decides the actions. */
type RoundState = { number: number; status: RoundStatus }

/** The actions this round allows, in the order they're shown. No round, no actions. */
export function allowedActions(round: RoundState | null | undefined): RoundAction[] {
  if (!round) return []
  switch (round.status) {
    case 'waiting':
      return [{ kind: 'open', defaultMinutes: DEFAULT_OPEN_MINUTES }]
    case 'open':
      return [{ kind: 'extend', defaultMinutes: DEFAULT_EXTEND_MINUTES }, { kind: 'start' }]
    case 'running':
      return [{ kind: 'retry' }]
    case 'review':
      return [{ kind: 'publish' }]
    case 'published':
      return round.number < FINAL_ROUND_NUMBER ? [{ kind: 'open-next', defaultMinutes: DEFAULT_OPEN_MINUTES }] : []
    default:
      return []
  }
}

/** The last round has been published: nothing is left to run. */
export const isTournamentComplete = (round: RoundState | null | undefined): boolean =>
  !!round && round.status === 'published' && round.number >= FINAL_ROUND_NUMBER

/**
 * The round to open after `current` is published. The overview only names the current round,
 * so its id comes from GET /rounds: the round numbered one higher, still waiting. Undefined when
 * there is none (the last round, rounds not loaded yet, or it has already left waiting).
 */
export function nextRound<R extends { id: number; number: number; status: RoundStatus }>(rounds: readonly R[] | null | undefined, current: { number: number }): R | undefined {
  return rounds?.find((r) => r.number === current.number + 1 && r.status === 'waiting')
}

export const UNREACHABLE = 'Could not reach the server. Try again in a moment.'

/**
 * What to tell the organiser when an action fails. Branches on the error code, never the message.
 *   INVALID_ROUND_TRANSITION  the round moved on (Retry: its matches are still playing)
 *   VALIDATION_ERROR, others  the server's own message
 */
export function actionErrorMessage(kind: RoundActionKind, err: unknown): string {
  if (hasCode(err, 'INVALID_ROUND_TRANSITION')) {
    return kind === 'retry' ? 'Matches are still playing. Retry only works after a failed run.' : "That action isn't allowed right now, the round may have changed."
  }
  return errorMessage(err, UNREACHABLE)
}

export type MinutesCheck = { ok: true; minutes: number } | { ok: false; message: string }

/**
 * Checks a minutes field before Open or Extend is sent: a whole number from 1 to 240.
 * The server checks it too (400 VALIDATION_ERROR); this only saves a round trip.
 */
export function checkMinutes(input: string | number): MinutesCheck {
  const text = String(input).trim()
  const message = `Enter a whole number of minutes from ${MIN_WINDOW_MINUTES} to ${MAX_WINDOW_MINUTES}.`
  if (!/^\d+$/.test(text)) return { ok: false, message }
  const minutes = Number(text)
  if (minutes < MIN_WINDOW_MINUTES || minutes > MAX_WINDOW_MINUTES) return { ok: false, message }
  return { ok: true, minutes }
}
