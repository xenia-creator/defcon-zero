/**
 * The three rounds as teams see them. Everything that differs between games lives here.
 *
 * NOT FINAL: the strategy() shape in the templates for rounds 2 and 3 is a
 * placeholder until the engine's helper function list and final
 * rules are in. So are their blocks, in ../blocks/categories.ts.
 */
export const TOTAL_ROUNDS = 3

export type GameInfo = {
  name: string
  brief: string
  question: string
  template: string
  /** Moves are "C" and "D", so the move strips and move suggestions apply. */
  moves: boolean
  blocks: boolean
  usesNoise: boolean
}

const GAMES: Record<string, GameInfo> = {
  prisoners_dilemma: {
    name: "The Prisoner's Dilemma",
    brief: 'A pot of points sits between two nations. Each secretly chooses to cooperate (share) or betray (grab it). Betrayal tempts, but if both betray, both lose. Played over many rounds, so trust, revenge and forgiveness build up.',
    question: 'Can your bot build trust, and know when to break it?',
    moves: true,
    blocks: true,
    usesNoise: true,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per turn. Return "C" to cooperate or "D" to betray.

    my_history and opp_history are lists of the moves played so far.
    Block modules you build are functions you can call here,
    for example: if my_module(my_history, opp_history): ...
    """
    if not opp_history:
        return "C"
    return opp_history[-1]
`,
  },
  theatre_of_war: {
    name: 'Theatre of War',
    brief: 'Each nation spreads 100 troops across 5 regions. Whoever sends more troops to a region wins it. Take the majority of regions to win the battle. Going all-in on one region loses; the art is how you divide your forces.',
    question: 'Concentrate or spread? Every plan can be beaten by another.',
    moves: false,
    blocks: true,
    usesNoise: false,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per battle. Return 5 whole numbers, one per region, adding up to 100.

    my_history and opp_history are lists of the splits played so far,
    for example: [[20, 20, 20, 20, 20], [40, 30, 10, 10, 10]]
    """
    return [20, 20, 20, 20, 20]
`,
  },
  foreign_aid: {
    name: 'Foreign Aid',
    brief: 'One nation sends any amount of points, and it triples on arrival. The receiver then decides how much to send back. Roles alternate. The reward for trust is huge, and so is the risk of being left with nothing.',
    question: 'How much do you trust, and how much do you repay?',
    moves: false,
    blocks: true,
    usesNoise: true,
    template: `import random


def strategy(my_history, opp_history, role, amount):
    """Called once per turn. Return how many points to send.

    role is "send" or "return".
    When sending, amount is the most you can send.
    When returning, amount is what arrived after tripling.
    """
    if role == "send":
        return amount // 2
    return amount // 2
`,
  },
}

export const DEFAULT_GAME = 'prisoners_dilemma'

/** docs/api.md gives each round a number and a name but no game key, so the number picks the game. */
const GAME_BY_ROUND: Record<number, string> = { 1: 'prisoners_dilemma', 2: 'theatre_of_war', 3: 'foreign_aid' }
export const gameKeyOf = (round: { number: number }) => GAME_BY_ROUND[round.number] ?? `round_${round.number}`

/** An unknown key still gives a working editor, so a new game on the server can't break the screen. */
export const gameInfo = (key: string, serverName?: string): GameInfo =>
  GAMES[key] ?? {
    name: serverName ?? key,
    brief: '',
    question: '',
    moves: false,
    blocks: false,
    usesNoise: true,
    template: 'def strategy(my_history, opp_history):\n    pass\n',
  }
