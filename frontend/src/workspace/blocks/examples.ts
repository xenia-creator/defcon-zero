/** Ready-made block strategies for each game, so a team starts from something that plays. */
import { newId } from '../../lib/ids'
import { blockSet } from './categories'
import { blockTypes, countBlocks, type BlockState, type Layout } from './layout'

const ifElse = (condition: BlockState, then: BlockState, otherwise: BlockState): BlockState => ({
  type: 'controls_ifelse',
  inputs: { IF0: { block: condition }, DO0: { block: then }, ELSE: { block: otherwise } },
})

const play = (MOVE: 'C' | 'D'): BlockState => ({ type: 'ic_play', fields: { MOVE } })
const firstTurn: BlockState = { type: 'ic_first_turn' }
const oppLast = (MOVE: 'C' | 'D'): BlockState => ({ type: 'ic_opp_last', fields: { MOVE } })
const oppRate = (PERCENT: number): BlockState => ({ type: 'ic_opp_rate', fields: { OP: 'GT', PERCENT } })
const chance = (PERCENT: number): BlockState => ({ type: 'ic_chance', fields: { PERCENT } })

const troops = (R1: number, R2: number, R3: number, R4: number, R5: number): BlockState => ({ type: 'ic_send_troops', fields: { R1, R2, R3, R4, R5 } })
const copySplit: BlockState = { type: 'ic_copy_split' }
const oppRegion = (REGION: string, TROOPS: number): BlockState => ({ type: 'ic_opp_region', fields: { REGION, TROOPS } })

const share = (PERCENT: number): BlockState => ({ type: 'ic_send_percent', fields: { PERCENT } })
const sending: BlockState = { type: 'ic_role', fields: { ROLE: 'send' } }
const amountOver = (POINTS: number): BlockState => ({ type: 'ic_amount', fields: { POINTS } })

export type Example = { name: string; about: string; body: BlockState }

export const EXAMPLES: Record<string, Example[]> = {
  prisoners_dilemma: [
    { name: 'Tit for tat', about: 'Start friendly, then copy what the opponent just did', body: ifElse(firstTurn, play('C'), ifElse(oppLast('D'), play('D'), play('C'))) },
    { name: 'Grudge', about: 'Cooperate until the opponent betrays too often', body: ifElse(oppRate(25), play('D'), play('C')) },
    { name: 'Forgiving', about: 'Hit back after a betrayal, but sometimes let it go', body: ifElse(oppLast('D'), ifElse(chance(20), play('C'), play('D')), play('C')) },
  ],
  theatre_of_war: [
    { name: 'Even spread', about: 'The same troops in every region', body: troops(20, 20, 20, 20, 20) },
    { name: 'Strong three', about: 'Win three regions and give up the other two', body: troops(34, 33, 33, 0, 0) },
    { name: 'Adapt', about: 'If the opponent was heavy on region 1, give it up and take the rest', body: ifElse(oppRegion('1', 30), troops(0, 34, 33, 33, 0), troops(34, 33, 33, 0, 0)) },
    { name: 'Copycat', about: "Open evenly, then copy the opponent's last split", body: copySplit },
  ],
  foreign_aid: [
    { name: 'Fair partner', about: 'Send half and return half', body: ifElse(sending, share(50), share(50)) },
    { name: 'Careful', about: 'Send less when more is at risk, and return a fair share', body: ifElse(sending, ifElse(amountOver(50), share(25), share(50)), share(40)) },
    { name: 'Greedy', about: 'Send a little and return nothing', body: ifElse(sending, share(10), share(0)) },
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

/** Only examples this round's rules allow: a limit on blocks or categories hides the others. */
export function examplesFor(game: string, categories: string[], maxBlocks: number): Example[] {
  const set = blockSet(game)
  const allowed = new Set(['ic_module', ...set.moves, ...categories.flatMap((c) => set.categories[c]?.blocks ?? [])])
  return (EXAMPLES[game] ?? []).filter((example) => {
    const layout = exampleLayout(example, 'x')
    return countBlocks(layout) <= maxBlocks && blockTypes(layout).every((type) => allowed.has(type))
  })
}
