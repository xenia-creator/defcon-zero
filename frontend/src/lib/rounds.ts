/**
 * The three rounds of DEFCON Zero: the one place that says which game each round
 * plays, what it is called and its DEFCON level. Every screen that names a round
 * (header, editor, war map, Command Console) reads it from here, so they can't drift apart.
 *
 * The server's round.game stays the authority for what is being played right now;
 * this table only names it and pairs it with its round number.
 */
export type GameKey = 'prisoners_dilemma' | 'theatre_of_war' | 'foreign_aid'

export interface RoundInfo {
  number: 1 | 2 | 3
  /** Rounds count up while DEFCON counts down: round 1 is DEFCON 3, round 3 is DEFCON 1. */
  defcon: 1 | 2 | 3
  game: GameKey
  name: string
  /** The game-theory name, shown next to the event name. */
  also: string
}

export const ROUNDS: readonly RoundInfo[] = [
  { number: 1, defcon: 3, game: 'prisoners_dilemma', name: "The Prisoner's Dilemma", also: 'Cooperate or betray' },
  { number: 2, defcon: 2, game: 'theatre_of_war', name: 'Theatre of War', also: 'Colonel Blotto' },
  { number: 3, defcon: 1, game: 'foreign_aid', name: 'Foreign Aid', also: 'The Trust Game' },
]

export const roundByNumber = (n: number | null | undefined): RoundInfo | undefined => ROUNDS.find((r) => r.number === n)

export const roundByGame = (game: string | null | undefined): RoundInfo | undefined => ROUNDS.find((r) => r.game === game)

/** The event name for a game key; an unknown game shows its key rather than a wrong name. */
export const gameName = (game: string): string => roundByGame(game)?.name ?? game

/** DEFCON 3, 2, 1 for the three rounds, and 0 (DEFCON ZERO) once the final results are out. */
export function defconLevel(round: { number: number; status: string } | null | undefined): 0 | 1 | 2 | 3 {
  if (!round) return 3
  if (round.number >= 3 && round.status === 'published') return 0
  return roundByNumber(round.number)?.defcon ?? (round.number > 3 ? 1 : 3)
}

/** "Cooperate (C)" for a named move with a label, the move itself otherwise. */
export const moveOption = (move: string, label: string): string =>
  label.toLowerCase() === move.toLowerCase() ? move : `${label.charAt(0).toUpperCase()}${label.slice(1)} (${move})`
