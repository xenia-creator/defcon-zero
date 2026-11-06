/** The blocks teams build with, kept apart from Blockly so screens can read them without loading the editor. */
export const RED = '#c0392b'
export const AMBER = '#d68910'
export const BLUE = '#3867d6'
export const TEAL = '#16a085'

/** The same six blocks in every round. Only the moves differ, and those come from the round's config. */
export const TOOLBOX = [
  { label: 'Moves', colour: RED, blocks: ['ic_play'] },
  { label: 'Logic', colour: BLUE, blocks: ['controls_ifelse'] },
  { label: 'Opponent', colour: AMBER, blocks: ['ic_opp_last', 'ic_opp_rate', 'ic_first_turn'] },
  { label: 'Chance', colour: TEAL, blocks: ['ic_chance'] },
]

/** What strategy() and every module receive, in all three rounds. */
export const MODULE_ARGS = 'my_history, opp_history'

const MOVE_LABELS: Record<string, string> = { C: 'cooperate', D: 'betray' }
export const moveLabel = (move: string) => MOVE_LABELS[move] ?? move.toLowerCase()
