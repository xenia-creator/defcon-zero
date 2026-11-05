/** Ready-made block strategies for each game, so a team starts from something that plays. */
import { newId } from '../../lib/ids'
import { countBlocks, type BlockState, type Layout } from './layout'

const ifElse = (condition: BlockState, then: BlockState, otherwise: BlockState): BlockState => ({
  type: 'controls_ifelse',
  inputs: { IF0: { block: condition }, DO0: { block: then }, ELSE: { block: otherwise } },
})

const play = (MOVE: string): BlockState => ({ type: 'ic_play', fields: { MOVE } })
const firstTurn: BlockState = { type: 'ic_first_turn' }
const oppLast = (MOVE: string): BlockState => ({ type: 'ic_opp_last', fields: { MOVE } })
const oppOften = (MOVE: string, PERCENT: number): BlockState => ({ type: 'ic_opp_rate', fields: { MOVE, OP: 'GT', PERCENT } })
const chance = (PERCENT: number): BlockState => ({ type: 'ic_chance', fields: { PERCENT } })

export type Example = { name: string; about: string; body: BlockState }

export const EXAMPLES: Record<string, Example[]> = {
  prisoners_dilemma: [
    { name: 'Tit for tat', about: 'Start friendly, then copy what the opponent just did', body: ifElse(firstTurn, play('C'), ifElse(oppLast('D'), play('D'), play('C'))) },
    { name: 'Grudge', about: 'Cooperate until the opponent betrays too often', body: ifElse(oppOften('D', 25), play('D'), play('C')) },
    { name: 'Forgiving', about: 'Hit back after a betrayal, but sometimes let it go', body: ifElse(oppLast('D'), ifElse(chance(20), play('C'), play('D')), play('C')) },
  ],
  theatre_of_war: [
    { name: 'Builder', about: 'Expand, and defend right after being attacked', body: ifElse(oppLast('ATTACK'), play('DEFEND'), play('EXPAND')) },
    { name: 'Counter', about: "Play whatever beats the opponent's last move", body: ifElse(oppLast('EXPAND'), play('ATTACK'), ifElse(oppLast('ATTACK'), play('DEFEND'), play('EXPAND'))) },
    { name: 'Fortress', about: 'Defend, and attack back if attacked too often', body: ifElse(oppOften('ATTACK', 50), play('ATTACK'), play('DEFEND')) },
  ],
  foreign_aid: [
    { name: 'Reciprocate', about: 'Aid first, then copy what the opponent just did', body: ifElse(firstTurn, play('AID'), ifElse(oppLast('WITHHOLD'), play('WITHHOLD'), play('AID'))) },
    { name: 'Grudge', about: 'Aid until the opponent withholds too often', body: ifElse(oppOften('WITHHOLD', 25), play('WITHHOLD'), play('AID')) },
    { name: 'Forgiving', about: 'Withhold after being refused, but sometimes aid anyway', body: ifElse(oppLast('WITHHOLD'), ifElse(chance(20), play('AID'), play('WITHHOLD')), play('AID')) },
  ],
}

export function exampleLayout(example: Example, name: string): Layout {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: 'ic_module', id: newId(), x: 24, y: 24, deletable: false, fields: { NAME: name }, inputs: { BODY: { block: example.body } } }],
    },
  }
}

/** Only examples this game has and that fit within the blocks still free. */
export const examplesFor = (game: string, blocksFree: number): Example[] => (EXAMPLES[game] ?? []).filter((example) => countBlocks(exampleLayout(example, 'x')) <= blocksFree)
