/** The blocks teams build with, kept apart from Blockly so screens can read them without loading the editor. */

/**
 * Printing-ink colours, muted to match the app's trench palette. Block text is white, and every
 * ink passes WCAG AA with it (5.4:1 or more). Every ink also stands at least 3:1 off the canvas.
 */
export const INK = {
  rust: '#a8482a',
  slate: '#4a6a94',
  ochre: '#8a631c',
  plum: '#86507b',
  olive: '#666c2c',
  moss: '#36735a',
} as const

export type Category = {
  /** Also the toolbox item id, so a guide can point at a category. */
  id: string
  label: string
  colour: string
  blocks: string[]
}

/**
 * Categories by job: Actions (red, notched) are the only statements; everything else plugs into a slot.
 * Numbers (olive) is used by Round 3 only.
 */
export const CATEGORY = {
  actions: { id: 'actions', label: 'Actions', colour: INK.rust },
  logic: { id: 'logic', label: 'Logic', colour: INK.slate },
  opponent: { id: 'opponent', label: 'Opponent', colour: INK.ochre },
  me: { id: 'me', label: 'Me & match', colour: INK.plum },
  numbers: { id: 'numbers', label: 'Numbers', colour: INK.olive },
  chance: { id: 'chance', label: 'Chance', colour: INK.moss },
} as const

/** Round 1. The strategy block isn't here: it is always on the canvas and can't be deleted. */
export const TOOLBOX: Category[] = [
  { ...CATEGORY.actions, blocks: ['ic_play'] },
  { ...CATEGORY.logic, blocks: ['ic_if', 'controls_ifelse', 'logic_operation', 'logic_negate'] },
  { ...CATEGORY.opponent, blocks: ['ic_opp_last', 'ic_opp_ever', 'ic_opp_rate'] },
  { ...CATEGORY.me, blocks: ['ic_my_last', 'ic_first_turn'] },
  { ...CATEGORY.chance, blocks: ['ic_chance'] },
]

/** Round 3. The send and send-back actions only work in their own section of the strategy block. */
export const FA_TOOLBOX: Category[] = [
  { ...CATEGORY.actions, blocks: ['fa_send', 'fa_return', 'fa_return_pct'] },
  { ...CATEGORY.logic, blocks: ['ic_if', 'controls_ifelse', 'logic_operation', 'logic_negate', 'fa_compare'] },
  { ...CATEGORY.opponent, blocks: ['fa_opp_sent_last', 'fa_opp_returned_last', 'fa_opp_avg', 'fa_opp_ever_short'] },
  { ...CATEGORY.me, blocks: ['fa_received', 'fa_my_last', 'fa_turn', 'fa_first_time'] },
  { ...CATEGORY.numbers, blocks: ['fa_number', 'fa_arith', 'fa_percent_of'] },
  { ...CATEGORY.chance, blocks: ['fa_random', 'ic_chance'] },
]

/** The toolbox for a game. Round 2 has no blocks, and an unknown game gets Round 1's. */
export const toolboxFor = (game: string): Category[] => (game === 'foreign_aid' ? FA_TOOLBOX : TOOLBOX)

/** Round 3 blocks in the wrong section. The generator reports these, and the block shows the same words in place. */
export const FA_MISPLACED = {
  sendInReceive: "Use 'send back' under 'when I'm receiving'.",
  returnInSend: "Use 'send' under 'when I'm sending'.",
  receivedInSend: "This only has a value when you're receiving.",
} as const

/** What strategy() and every module receive, in all three rounds. */
export const MODULE_ARGS = 'my_history, opp_history'

const MOVE_LABELS: Record<string, string> = { C: 'cooperate', D: 'betray' }
export const moveLabel = (move: string) => MOVE_LABELS[move] ?? move.toLowerCase()

/** The same move as something already done: "opponent betrayed last turn". */
const PAST_LABELS: Record<string, string> = { C: 'cooperated', D: 'betrayed' }
export const movePast = (move: string) => PAST_LABELS[move] ?? move.toLowerCase()
