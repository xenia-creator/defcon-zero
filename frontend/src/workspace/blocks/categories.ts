/** Which blocks each game offers, kept apart from Blockly so screens can read it without loading the editor. */
export const RED = '#c0392b'
export const AMBER = '#d68910'
export const BLUE = '#3867d6'
export const TEAL = '#16a085'

export type BlockGroup = { label: string; colour: string; blocks: string[] }
/** moves are always available; categories can be limited by the round's rules. args is what a module receives. */
export type BlockSet = { args: string; moves: string[]; categories: Record<string, BlockGroup> }

const logic: BlockGroup = { label: 'Logic', colour: BLUE, blocks: ['controls_ifelse'] }
const chance: BlockGroup = { label: 'Chance', colour: TEAL, blocks: ['ic_chance'] }

// Six blocks per game. Rounds 2 and 3 are placeholders until the final rules are in, like their templates in games.ts
const BLOCK_SETS: Record<string, BlockSet> = {
  prisoners_dilemma: {
    args: 'my_history, opp_history',
    moves: ['ic_play'],
    categories: { logic, history: { label: 'Opponent', colour: AMBER, blocks: ['ic_opp_last', 'ic_opp_rate', 'ic_first_turn'] }, chance },
  },
  theatre_of_war: {
    args: 'my_history, opp_history',
    moves: ['ic_send_troops', 'ic_copy_split'],
    categories: { logic, history: { label: 'Opponent', colour: AMBER, blocks: ['ic_opp_region', 'ic_first_turn'] }, chance },
  },
  foreign_aid: {
    args: 'my_history, opp_history, role, amount',
    moves: ['ic_send_percent'],
    categories: { logic, history: { label: 'Situation', colour: AMBER, blocks: ['ic_role', 'ic_amount', 'ic_first_turn'] }, chance },
  },
}

const NO_BLOCKS: BlockSet = { args: 'my_history, opp_history', moves: [], categories: {} }

export const blockSet = (game: string): BlockSet => BLOCK_SETS[game] ?? NO_BLOCKS
