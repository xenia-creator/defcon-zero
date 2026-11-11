/**
 * Ready-made block strategies for each game: "Start from this". Each one loads
 * into the canvas for the team to change; nothing is ever submitted from here.
 */
import { newId } from '../../lib/ids'
import { generateStrategy, type StrategyConfig } from './generate'
import { countBlocks, type BlockState, type Layout } from './layout'

/** A value slot: numbers go in as shadows, as the toolbox's pre-filled numbers do, so dropping a value on them replaces them cleanly. */
const slot = (value: BlockState) => (value.type === 'fa_number' ? { shadow: value } : { block: value })

const ifThen = (condition: BlockState, then: BlockState, next?: BlockState): BlockState => ({
  type: 'ic_if',
  inputs: { IF0: { block: condition }, DO0: { block: then } },
  ...(next ? { next: { block: next } } : {}),
})
const ifElse = (condition: BlockState, then: BlockState, otherwise: BlockState): BlockState => ({
  type: 'controls_ifelse',
  inputs: { IF0: { block: condition }, DO0: { block: then }, ELSE: { block: otherwise } },
})
const chance = (PERCENT: number): BlockState => ({ type: 'ic_chance', fields: { PERCENT } })

// Round 1
const play = (MOVE: string): BlockState => ({ type: 'ic_play', fields: { MOVE } })
const oppLast = (MOVE: string): BlockState => ({ type: 'ic_opp_last', fields: { MOVE } })
const oppEver = (MOVE: string): BlockState => ({ type: 'ic_opp_ever', fields: { MOVE } })
const pd = (body: BlockState, fallback = 'C'): BlockState => ({ type: 'ic_strategy', fields: { FALLBACK: fallback }, inputs: { BODY: { block: body } } })

// Round 3
const num = (NUM: number): BlockState => ({ type: 'fa_number', fields: { NUM } })
const send = (amount: BlockState): BlockState => ({ type: 'fa_send', inputs: { AMOUNT: slot(amount) } })
const sendBack = (amount: BlockState): BlockState => ({ type: 'fa_return', inputs: { AMOUNT: slot(amount) } })
const compare = (a: BlockState, OP: string, b: BlockState): BlockState => ({ type: 'fa_compare', fields: { OP }, inputs: { A: slot(a), B: slot(b) } })
const fa = (sending: BlockState | undefined, SEND_DEFAULT: number, receiving?: BlockState, RETURN_PCT_DEFAULT = 50): BlockState => ({
  type: 'fa_strategy',
  fields: { SEND_DEFAULT, RETURN_PCT_DEFAULT },
  inputs: { ...(sending ? { SEND: { block: sending } } : {}), ...(receiving ? { RECEIVE: { block: receiving } } : {}) },
})

/**
 * `strategy` is the whole strategy block: its fallbacks in `fields`, the example's blocks in its sections.
 * `weakness` is shown under the description, so a team sees what to improve.
 */
export type Example = { name: string; about: string; weakness: string; strategy: BlockState }

/** Shown with the list: identical submissions tie, and ties are broken by a random draw. */
export const EXAMPLES_NOTE = 'A starting point. Change it to make it yours: identical bots tie, and ties are a coin toss.'

export const EXAMPLES: Record<string, Example[]> = {
  prisoners_dilemma: [
    { name: 'Always Cooperate', about: 'Shares every turn, whatever the opponent does. Easy to exploit.', weakness: 'Weakness: any betrayer takes the big score from it, every single turn.', strategy: pd(play('C')) },
    { name: 'Always Betray', about: 'Grabs every turn. Wins against a trusting opponent, loses big against another betrayer.', weakness: 'Weakness: against another betrayer, both are stuck on the lowest score all match.', strategy: pd(play('D')) },
    { name: 'Tit for Tat', about: 'Starts friendly, then copies what the opponent did last turn.', weakness: 'Weakness: two copies can get stuck in endless revenge after a single betrayal.', strategy: pd(ifThen(oppLast('D'), play('D'))) },
    { name: 'Grudger', about: 'Cooperates until the opponent betrays once, then betrays forever.', weakness: 'Weakness: one betrayal, even a random one, ends cooperation for the rest of the match.', strategy: pd(ifThen(oppEver('D'), play('D'))) },
    {
      name: 'Forgiving Tit for Tat',
      about: 'Like Tit for Tat, but forgives a betrayal 10 % of the time, so two copies can stop a feud.', weakness: 'Weakness: an opponent that betrays now and then is often let off.',
      strategy: pd(ifThen(oppLast('D'), ifElse(chance(10), play('C'), play('D')))),
    },
  ],
  foreign_aid: [
    {
      name: 'Break Even',
      about: 'Sends 5. When receiving, sends back exactly what was sent, so the sender never loses and you keep the bonus.', weakness: 'Weakness: it keeps sending 5 to an opponent who never sends anything back.',
      strategy: fa(undefined, 5, sendBack({ type: 'fa_opp_sent_last' })),
    },
    {
      name: 'Mirror',
      about: 'Sends 10 while the opponent pays back at least what you sent last time, otherwise only 2. Sends back half.', weakness: 'Weakness: an opponent can short-change a 10, repay the next 2 in full, and get 10 again.',
      strategy: fa(ifThen(compare({ type: 'fa_opp_returned_last' }, 'GTE', { type: 'fa_my_last', fields: { WHAT: 'SEND' } }), send(num(10))), 2),
    },
    {
      name: 'Grudger',
      about: 'Sends 10 until the opponent ever sends back less than you sent, then sends nothing. Sends back half.', weakness: 'Weakness: one stingy send-back, even early, ends the trust and its bonus for good.',
      strategy: fa(ifThen({ type: 'fa_opp_ever_short' }, send(num(0))), 10),
    },
    {
      name: 'Matcher',
      about: "Sends 10 the first time, then the opponent's average send. Sends back half.", weakness: 'Weakness: it never sends more than the opponent does, so two careful bots stay low.',
      strategy: fa(ifThen({ type: 'fa_first_time' }, send(num(10)), send({ type: 'fa_opp_avg', fields: { WHAT: 'SEND' } })), 5),
    },
  ],
}

/** An example as a whole blocks-mode canvas: the strategy block, which can't be deleted, with the example inside. */
export function strategyLayout(example: Example): Layout {
  return { blocks: { languageVersion: 0, blocks: [{ ...example.strategy, id: newId(), x: 24, y: 24, deletable: false }] } }
}

/**
 * A Round 1 example as a Write-code module. A path that reaches no move plays the round's first move,
 * which is every Round 1 example's fallback.
 */
export function exampleLayout(example: Example, name: string): Layout {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: 'ic_module', id: newId(), x: 24, y: 24, deletable: false, fields: { NAME: name }, inputs: { BODY: { block: example.strategy.inputs?.BODY?.block } } }],
    },
  }
}

/** How many blocks an example uses, the strategy block included. */
export const exampleBlocks = (example: Example): number => countBlocks(strategyLayout(example))

/** The same Python, ignoring line endings and trailing spaces, which a team can't see. */
const normalise = (code: string) =>
  code
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

/**
 * The example whose strategy.py this exactly is, if any: identical bots tie, so a team is told before
 * submitting one unchanged. `config` is the round's, since Round 3 writes its limits into the file.
 */
export function matchingExample(code: string, game: string, config: StrategyConfig): Example | undefined {
  const mine = normalise(code)
  return (EXAMPLES[game] ?? []).find((example) => normalise(generateStrategy(strategyLayout(example), game, config).code) === mine)
}

/** Only examples this game has and that fit within the blocks still free. */
export const examplesFor = (game: string, blocksFree: number): Example[] => (EXAMPLES[game] ?? []).filter((example) => exampleBlocks(example) <= blocksFree)
