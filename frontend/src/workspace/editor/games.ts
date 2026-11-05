/**
 * The three rounds as teams see them, chosen by the round's `game`. The moves
 * and limits themselves come from the round's config.
 *
 * NOT FINAL: the round text and moves for rounds 2 and 3 follow docs/api.md v2
 * and the proposed engine rules, which the team has yet to approve.
 */
export const TOTAL_ROUNDS = 3

export type GameInfo = {
  name: string
  brief: string
  question: string
  template: string
  /** Used only until the round arrives from the server. */
  moves: string[]
  blocks: boolean
}

const GAMES: Record<string, GameInfo> = {
  prisoners_dilemma: {
    name: "The Prisoner's Dilemma",
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
  },
  theatre_of_war: {
    name: 'Theatre of War',
    brief: 'Each turn both nations secretly choose to attack, defend or expand. Attack beats expand, defend beats attack, and expand beats defend. Two nations expanding together score the most, but each is tempted to strike.',
    question: 'Build in peace, or strike first?',
    moves: ['ATTACK', 'DEFEND', 'EXPAND'],
    blocks: true,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per turn. Return "ATTACK", "DEFEND" or "EXPAND".

    my_history and opp_history are lists of the moves played so far, oldest first.
    Block modules you build are functions you can call here,
    for example: return my_module(my_history, opp_history)
    """
    if opp_history and opp_history[-1] == "ATTACK":
        return "DEFEND"
    return "EXPAND"
`,
  },
  foreign_aid: {
    name: 'Foreign Aid',
    brief: 'Each turn both nations secretly choose to aid or withhold. Aid costs the giver a little and gives the other nation far more. The reward for trust is huge, and so is the risk of being left with nothing.',
    question: 'How much do you trust, and how much do you repay?',
    moves: ['AID', 'WITHHOLD'],
    blocks: true,
    template: `import random


def strategy(my_history, opp_history):
    """Called once per turn. Return "AID" or "WITHHOLD".

    my_history and opp_history are lists of the moves played so far, oldest first.
    Block modules you build are functions you can call here,
    for example: return my_module(my_history, opp_history)
    """
    if not opp_history:
        return "AID"
    return opp_history[-1]
`,
  },
}

export const DEFAULT_GAME = 'prisoners_dilemma'

/** An unknown game still gives a working editor, so a new one on the server can't break the screen. */
export const gameInfo = (key: string): GameInfo =>
  GAMES[key] ?? {
    name: key,
    brief: '',
    question: '',
    moves: ['C', 'D'],
    blocks: false,
    template: 'def strategy(my_history, opp_history):\n    pass\n',
  }
