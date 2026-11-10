/**
 * The three rounds as teams see them, chosen by the round's `game`. The moves
 * and limits themselves come from the round's config: round 1 plays named moves,
 * rounds 2 and 3 play whole numbers whose limits are in the config.
 */
import type { Round } from '../../lib/contract'
import { gameName, roundByGame } from '../../lib/rounds'

export const TOTAL_ROUNDS = 3

type RoundConfig = Round['config']

export type GameInfo = {
  /** From the shared round table (lib/rounds.ts), so every screen names the round the same way. */
  name: string
  /** The game-theory name, for example Colonel Blotto. */
  also: string
  brief: string
  question: string
  template: string
  /** Used only until the round arrives from the server. */
  moves: string[]
  blocks: boolean
  /** The round's limits in a line, for games that play numbers instead of moves. */
  limits?: string
}

/**
 * Only for the moment before the round arrives (or if the server leaves a field out),
 * so the editor can still open. Whenever the round has these fields, they win.
 */
export const UNTIL_ROUND_ARRIVES = { troops: 100, regions: 5, endowment: 10, multiplier: 3 }

/** An even split, with any remainder going to the first regions: 100 over 5 is [20, 20, 20, 20, 20]. */
function evenSplit(troops: number, regions: number): number[] {
  const base = Math.floor(troops / regions)
  return Array.from({ length: regions }, (_, i) => base + (i < troops % regions ? 1 : 0))
}

function prisonersDilemma(): GameInfo {
  return {
    name: gameName('prisoners_dilemma'),
    also: roundByGame('prisoners_dilemma')!.also,
    brief: 'A pot of points sits between two nations. Each secretly chooses to cooperate (share) or betray (grab it). Betrayal tempts, but if both betray, both lose. Played over many turns, so trust, revenge and forgiveness build up.',
    question: 'Can your bot build trust, and know when to break it?',
    moves: ['C', 'D'],
    blocks: true,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per turn. Return "C" to cooperate or "D" to betray.

    my_history and opp_history are lists of the moves played so far, oldest first.
    Block modules you build are functions you can call here,
    for example: return my_module(my_history, opp_history)
    """
    if not opp_history:
        return "C"
    return opp_history[-1]
`,
  }
}

/** Round 2, Colonel Blotto: split the troops across the regions. */
function theatreOfWar(config?: RoundConfig): GameInfo {
  const troops = config?.troops ?? UNTIL_ROUND_ARRIVES.troops
  const regions = config?.regions ?? UNTIL_ROUND_ARRIVES.regions
  const even = `[${evenSplit(troops, regions).join(', ')}]`
  return {
    name: gameName('theatre_of_war'),
    also: roundByGame('theatre_of_war')!.also,
    brief: `Each turn both nations secretly split ${troops} troops across ${regions} regions. In each region, the nation that sent more troops takes it. Spread evenly and you are never crushed, but never dominant either.`,
    question: 'Where will you be strong, and where will you give ground?',
    moves: [],
    blocks: false,
    limits: `Return ${regions} whole numbers, none negative, adding up to ${troops}.`,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per turn. Return a list of ${regions} whole numbers: the troops you send
    to each of the ${regions} regions. None may be negative, and they must add up to ${troops}.

    my_history and opp_history are lists of the allocations played so far, oldest first.
    Each allocation is a list of ${regions} whole numbers, for example ${even}.
    """
    return ${even}
`,
  }
}

/** Round 3, the trust game: send, it multiplies on arrival, the receiver sends some back. Roles alternate. */
function foreignAid(config?: RoundConfig): GameInfo {
  const endowment = config?.endowment ?? UNTIL_ROUND_ARRIVES.endowment
  const multiplier = config?.multiplier ?? UNTIL_ROUND_ARRIVES.multiplier
  return {
    name: gameName('foreign_aid'),
    also: roundByGame('foreign_aid')!.also,
    brief: `Nations take turns as sender and receiver. The sender sends 0 to ${endowment} points, which arrive multiplied by ${multiplier}. The receiver then decides how much of that to send back. Trust pays off for both, and is easy to exploit.`,
    question: 'How much do you trust, and how much do you repay?',
    moves: [],
    blocks: true,
    limits: `Sending: a whole number from 0 to ${endowment}. Receiving: a whole number from 0 up to ${multiplier} × what was sent.`,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per turn. Every amount is a whole number.

    my_history and opp_history are the plain numbers each side played so far, oldest first.
    Your role this turn comes from their lengths:

    - Sending, when len(opp_history) == len(my_history):
      return how much to send, from 0 to ${endowment}.
    - Receiving, when len(opp_history) > len(my_history):
      the opponent just sent opp_history[-1], and you received ${multiplier} times that.
      Return how much to send back, from 0 up to ${multiplier} * opp_history[-1].
    """
    if len(opp_history) > len(my_history):
        received = ${multiplier} * opp_history[-1]
        return received // 2
    return ${Math.floor(endowment / 2)}
`,
  }
}

const GAMES: Record<string, (config?: RoundConfig) => GameInfo> = {
  prisoners_dilemma: prisonersDilemma,
  theatre_of_war: theatreOfWar,
  foreign_aid: foreignAid,
}

export const DEFAULT_GAME = 'prisoners_dilemma'

/**
 * The game as teams see it, with its limits read from the round's config when there is one.
 * An unknown game still gives a working editor, so a new one on the server can't break the screen.
 */
export const gameInfo = (key: string, config?: RoundConfig): GameInfo =>
  GAMES[key]?.(config) ?? {
    name: key,
    also: '',
    brief: '',
    question: '',
    moves: ['C', 'D'],
    blocks: false,
    template: 'def strategy(my_history, opp_history):\n    pass\n',
  }
