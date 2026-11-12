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

/**
 * A Round 3 canvas exactly as the editor saved it before the Opponent labels were reworded
 * ("sent last" / "sent back last" became "gave me last" / "returned last"). Only the words on
 * the blocks changed: the block types, field names and values stay, so old drafts load the same.
 */
const SAVED_BEFORE_RENAME = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'fa_strategy',
        id: 'root',
        x: 24,
        y: 24,
        deletable: false,
        fields: { SEND_DEFAULT: 5, RETURN_PCT_DEFAULT: 50 },
        inputs: {
          SEND: {
            block: {
              type: 'ic_if',
              id: 'if1',
              inputs: {
                IF0: {
                  block: {
                    type: 'fa_compare',
                    id: 'cmp1',
                    fields: { OP: 'GTE' },
                    inputs: {
                      A: { shadow: { type: 'fa_number', id: 'n1', fields: { NUM: 5 } }, block: { type: 'fa_opp_returned_last', id: 'ret' } },
                      B: { shadow: { type: 'fa_number', id: 'n2', fields: { NUM: 5 } }, block: { type: 'fa_opp_avg', id: 'avgS', fields: { WHAT: 'SEND' } } },
                    },
                  },
                },
                DO0: { block: { type: 'fa_send', id: 'snd1', inputs: { AMOUNT: { shadow: { type: 'fa_number', id: 'n3', fields: { NUM: 5 } }, block: { type: 'fa_opp_sent_last', id: 'sent' } } } } },
              },
              next: {
                block: {
                  type: 'ic_if',
                  id: 'if2',
                  inputs: {
                    IF0: { block: { type: 'fa_opp_ever_short', id: 'short' } },
                    DO0: { block: { type: 'fa_send', id: 'snd2', inputs: { AMOUNT: { shadow: { type: 'fa_number', id: 'n4', fields: { NUM: 0 } } } } } },
                  },
                },
              },
            },
          },
          RECEIVE: {
            block: {
              type: 'ic_if',
              id: 'if3',
              inputs: {
                IF0: {
                  block: {
                    type: 'fa_compare',
                    id: 'cmp2',
                    fields: { OP: 'LT' },
                    inputs: {
                      A: { shadow: { type: 'fa_number', id: 'n5', fields: { NUM: 5 } }, block: { type: 'fa_opp_avg', id: 'avgR', fields: { WHAT: 'RETURN_PCT' } } },
                      B: { shadow: { type: 'fa_number', id: 'n6', fields: { NUM: 34 } } },
                    },
                  },
                },
                DO0: { block: { type: 'fa_return', id: 'back', inputs: { AMOUNT: { shadow: { type: 'fa_number', id: 'n7', fields: { NUM: 5 } }, block: { type: 'fa_opp_sent_last', id: 'sent2' } } } } },
              },
            },
          },
        },
      },
    ],
  },
} as unknown as Layout

describe('Round 3 Opponent labels', () => {
  it('a layout saved before the rename loads, saves back unchanged, and generates the same Python', () => {
    const { saved } = roundTrip(SAVED_BEFORE_RENAME)
    expect(saved).toEqual(SAVED_BEFORE_RENAME)
    const python = generateStrategy(saved, 'foreign_aid', CONFIG)
    expect(python.problems).toEqual([])
    expect(python).toEqual(generateStrategy(SAVED_BEFORE_RENAME, 'foreign_aid', CONFIG))
    expect(python.code).toMatchInlineSnapshot(`
      "ENDOWMENT = 10  # the most you can send (config.endowment)
      MULTIPLIER = 3  # what you send arrives multiplied by this (config.multiplier)


      def legal_send(amount):
          """Any amount becomes a legal send: a whole number from 0 to ENDOWMENT."""
          return max(0, min(ENDOWMENT, int(amount)))


      def legal_return(amount, received):
          """Any amount becomes a legal send-back: a whole number from 0 to what you received."""
          return max(0, min(received, int(amount)))


      def split_history(my_history, opp_history):
          """Each turn one side sends and the other sends back, so both histories mix the two.
          This sorts them into what each side sent and sent back, oldest first.
          my_sent[i] goes with opp_returned[i], and opp_sent[i] with my_returned[i]."""
          start = len(opp_history) % 2   # where my sends sit in my history
          my_sent = my_history[start::2]
          my_returned = my_history[1 - start::2]
          opp_sent = opp_history[1 - start::2]
          opp_returned = opp_history[start::2]
          return my_sent, my_returned, opp_sent, opp_returned


      def average(values):
          """The average, or 0 when there is nothing yet."""
          return sum(values) / len(values) if values else 0


      def return_rate(opp_returned, my_sent):
          """What % of what they received the opponent sent back. 0 until they have had something to send back."""
          received = MULTIPLIER * sum(my_sent[:len(opp_returned)])
          return 100 * sum(opp_returned) / received if received > 0 else 0


      def ever_short_changed(my_sent, opp_returned):
          """True if the opponent ever sent back less than I sent them."""
          return any(back < sent for sent, back in zip(my_sent, opp_returned))


      def strategy(my_history, opp_history):
          my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
          if len(opp_history) == len(my_history):
              # When I'm sending
              if ((opp_returned[-1] if opp_returned else 0) >= average(opp_sent)):
                  return legal_send((opp_sent[-1] if opp_sent else 0))
              if ever_short_changed(my_sent, opp_returned):
                  return legal_send(0)
              # If nothing above decided
              return legal_send(5)
          # When I'm receiving: the opponent just sent opp_history[-1]
          received = MULTIPLIER * opp_history[-1]
          if (return_rate(opp_returned, my_sent) < 34):
              return legal_return((opp_sent[-1] if opp_sent else 0), received)
          # If nothing above decided
          return legal_return(received * 50 // 100, received)
      "
    `)
  })
})

describe('Round 3 Opponent labels: the words on the blocks', () => {
  it('"gave me" and "returned" tell the look-alike blocks apart', () => {
    const { ws } = roundTrip(SAVED_BEFORE_RENAME)
    const text = (id: string) => ws.getBlockById(id)!.toString()
    expect(text('sent')).toBe('what the opponent gave me last')
    expect(text('ret')).toBe('what the opponent returned last')
    expect(text('short')).toBe('the opponent has ever returned less than I sent')
    expect(text('avgS')).toBe('on average, what the opponent gave me')
    expect(text('avgR')).toBe('on average, what the opponent returned (%)')
    // No Opponent block still says "sent last" or "sent back", the words that were mixed up
    const words = ['fa_opp_sent_last', 'fa_opp_returned_last', 'fa_opp_avg', 'fa_opp_ever_short'].map((type) => ws.newBlock(type).toString()).join(' | ')
    expect(words).not.toMatch(/sent last|sent back|send-back/)
  })
})
