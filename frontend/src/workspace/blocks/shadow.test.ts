/**
 * Number slots are shadows (frontend/docs/BLOCKS.md 2.3 step 6): a value dropped on one replaces it
 * with nothing left loose. The generated Python must be exactly the same as with real number blocks.
 */
import { describe, expect, it } from 'vitest'
import { EXAMPLES, strategyLayout } from './examples'
import { generateStrategy } from './generate'
import { countBlocks, slotValue, type BlockState, type Layout } from './layout'

const CONFIG = { moves: [], endowment: 10, multiplier: 3 }

/** The same layout with every shadow turned into a real block, as layouts were saved before shadows. */
function asRealBlocks(block: BlockState): BlockState {
  const inputs = block.inputs
    ? Object.fromEntries(Object.entries(block.inputs).map(([name, slot]) => [name, slot ? { block: asRealBlocks(slotValue(slot)!) } : slot]))
    : undefined
  return { ...block, ...(inputs ? { inputs } : {}), ...(block.next?.block ? { next: { block: asRealBlocks(block.next.block) } } : {}) }
}
const realLayout = (layout: Layout): Layout => {
  const blocks = (layout.blocks as { blocks: BlockState[] }).blocks
  return { blocks: { languageVersion: 0, blocks: blocks.map(asRealBlocks) } }
}

describe('shadow number slots', () => {
  it('the Round 3 examples now use shadows for their numbers', () => {
    const grudger = EXAMPLES.foreign_aid.find((e) => e.name === 'Grudger')!
    expect(JSON.stringify(grudger.strategy)).toContain('"shadow"')
  })

  it('generate exactly the same Python as real number blocks, for every Round 3 example', () => {
    for (const example of EXAMPLES.foreign_aid) {
      const layout = strategyLayout(example)
      const withShadows = generateStrategy(layout, 'foreign_aid', CONFIG)
      const withBlocks = generateStrategy(realLayout(layout), 'foreign_aid', CONFIG)
      expect([example.name, withShadows.problems]).toEqual([example.name, []])
      expect(withShadows.code).toBe(withBlocks.code)
    }
  })

  it('a value dropped on a shadow wins, and the covered shadow neither counts nor reaches the Python', () => {
    const sendBack: BlockState = { type: 'fa_return', inputs: { AMOUNT: { block: { type: 'fa_opp_sent_last' }, shadow: { type: 'fa_number', fields: { NUM: 5 } } } } }
    const layout: Layout = { blocks: { languageVersion: 0, blocks: [{ type: 'fa_strategy', fields: { SEND_DEFAULT: 5, RETURN_PCT_DEFAULT: 50 }, inputs: { RECEIVE: { block: sendBack } } }] } }
    const code = generateStrategy(layout, 'foreign_aid', CONFIG).code
    expect(code).toContain('return legal_return((opp_sent[-1] if opp_sent else 0), received)')
    expect(countBlocks(layout)).toBe(3) // strategy, send back, what the opponent sent last
  })

  it('an uncovered shadow counts like the number block it stands for', () => {
    const send = (amount: object): BlockState => ({ type: 'fa_send', inputs: { AMOUNT: amount } })
    const wrap = (b: BlockState): Layout => ({ blocks: { languageVersion: 0, blocks: [b] } })
    expect(countBlocks(wrap(send({ shadow: { type: 'fa_number', fields: { NUM: 0 } } })))).toBe(2)
    expect(countBlocks(wrap(send({ block: { type: 'fa_number', fields: { NUM: 0 } } })))).toBe(2)
    expect(slotValue({ shadow: { type: 'fa_number' } })?.type).toBe('fa_number')
    expect(slotValue(null)).toBeUndefined()
  })
})
