/** The block definitions in real Blockly (headless): every saved layout the generator reads must also load in the editor. */
import { describe, expect, it } from 'vitest'
import { Blockly, sectionOf, setBlockEndowment, toolbox } from './blocks'
import { FA_TOOLBOX, TOOLBOX } from './categories'
import { EXAMPLES, strategyLayout } from './examples'
import { generateStrategy } from './generate'
import { countBlocks, newStrategy, type Layout } from './layout'

const CONFIG = { moves: ['C', 'D'], endowment: 10, multiplier: 3 }

/** Loads a layout into a fresh headless workspace and saves it straight back. */
function roundTrip(layout: Layout): { saved: Layout; ws: Blockly.Workspace } {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(layout, ws)
  return { saved: Blockly.serialization.workspaces.save(ws) as Layout, ws }
}

describe('block definitions', () => {
  it('every block in both toolboxes exists and can be made', () => {
    const ws = new Blockly.Workspace()
    for (const type of new Set([...TOOLBOX, ...FA_TOOLBOX].flatMap((c) => c.blocks))) expect(() => ws.newBlock(type), type).not.toThrow()
    for (const type of ['ic_strategy', 'fa_strategy', 'ic_module']) expect(() => ws.newBlock(type), type).not.toThrow()
  })

  it.each([...EXAMPLES.prisoners_dilemma.map((e) => ['prisoners_dilemma', e] as const), ...EXAMPLES.foreign_aid.map((e) => ['foreign_aid', e] as const)])(
    '%s example "%s" loads in Blockly and saves back to the same Python',
    (game, example) => {
      const layout = strategyLayout(example)
      const { saved } = roundTrip(layout)
      expect(countBlocks(saved)).toBe(countBlocks(layout))
      expect(generateStrategy(saved, game, CONFIG)).toEqual(generateStrategy(layout, game, CONFIG))
    },
  )

  it('a new strategy canvas loads for both rounds, and its block cannot be deleted', () => {
    for (const game of ['prisoners_dilemma', 'foreign_aid']) {
      const { ws } = roundTrip(newStrategy(game, CONFIG.moves))
      const [top] = ws.getTopBlocks()
      expect([top.type, top.isDeletable()]).toEqual([game === 'foreign_aid' ? 'fa_strategy' : 'ic_strategy', false])
    }
  })

  it('every pre-filled toolbox block loads with its numbers in place', () => {
    const contents = (toolbox('foreign_aid') as unknown as { contents: { contents: Record<string, unknown>[] }[] }).contents.flatMap((c) => c.contents)
    expect(contents).toHaveLength(21)
    const ws = new Blockly.Workspace()
    for (const { kind: _, ...state } of contents) {
      const block = Blockly.serialization.blocks.append(state as unknown as Blockly.serialization.blocks.State, ws)
      // every number slot arrives filled
      for (const input of block.inputList) if (input.connection?.getCheck()?.includes('Number')) expect(input.connection.targetBlock(), `${block.type}.${input.name}`).not.toBeNull()
    }
  })

  it('the send fallback is limited to the round endowment', () => {
    setBlockEndowment(20)
    try {
      const ws = new Blockly.Workspace()
      const field = ws.newBlock('fa_strategy').getField('SEND_DEFAULT') as Blockly.FieldNumber
      expect(field.getMax()).toBe(20)
    } finally {
      setBlockEndowment(10)
    }
  })

  it('knows which section a block sits in, at any depth', () => {
    const grudger = EXAMPLES.foreign_aid.find((e) => e.name === 'Grudger')!
    const breakEven = EXAMPLES.foreign_aid.find((e) => e.name === 'Break Even')!
    const { ws } = roundTrip(strategyLayout(grudger))
    expect(sectionOf(ws.getBlocksByType('fa_number')[0])).toBe('SEND')
    expect(sectionOf(ws.getBlocksByType('fa_opp_ever_short')[0])).toBe('SEND')
    const other = roundTrip(strategyLayout(breakEven)).ws
    expect(sectionOf(other.getBlocksByType('fa_opp_sent_last')[0])).toBe('RECEIVE')
    expect(sectionOf(other.newBlock('fa_send'))).toBeNull()
  })
})
