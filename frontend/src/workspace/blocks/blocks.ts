/**
 * Blockly setup: the six blocks, the toolbox, and a theme matching the app.
 * generate.ts turns layouts into Python.
 */
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import * as En from 'blockly/msg/en'

Blockly.setLocale(En as unknown as Record<string, string>)
// Easier to drop a block into its slot than the default, which needs a close aim
Blockly.config.snapRadius = 48
Blockly.config.connectingSnapRadius = 68

import { AMBER, RED, TEAL, TOOLBOX, moveLabel } from './categories'

// Registering twice throws, which would happen on every hot reload in development
if (!Blockly.Extensions.isRegistered('ic_module_name')) {
  Blockly.Extensions.register('ic_module_name', function (this: Blockly.Block) {
    const field = this.getField('NAME') as Blockly.FieldTextInput
    // Python-safe names: lowercase letters, digits and _, starting with a letter
    field.setValidator((value: string) => {
      const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 31)
      return clean || null
    })
  })
}

/** The current round's moves. The dropdowns read this when a block is created, so call it before Blockly starts. */
let roundMoves = ['C', 'D']
export function setBlockMoves(moves: string[]) {
  roundMoves = moves
}
const moveField = { type: 'field_dropdown', name: 'MOVE' }
const moveOptions = () => roundMoves.map((move) => [moveLabel(move), move])

Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'ic_module',
    message0: 'module %1 %2 %3',
    args0: [{ type: 'field_input', name: 'NAME', text: 'my_module' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'BODY' }],
    colour: RED,
    extensions: ['ic_module_name'],
    tooltip: 'A helper your strategy can call',
  },
  { type: 'ic_first_turn', message0: 'first turn?', output: 'Boolean', colour: AMBER, tooltip: 'True on the first turn of a match' },
  {
    type: 'ic_chance',
    message0: '%1 %% chance',
    args0: [{ type: 'field_number', name: 'PERCENT', value: 10, min: 0, max: 100, precision: 1 }],
    output: 'Boolean',
    colour: TEAL,
    tooltip: 'True this often, at random',
  },
])

Blockly.Blocks.ic_play = {
  init(this: Blockly.Block) {
    this.jsonInit({
      message0: 'play %1',
      args0: [{ ...moveField, options: moveOptions() }],
      previousStatement: null,
      colour: RED,
      tooltip: 'Give back this move and stop the module',
    })
  },
}

Blockly.Blocks.ic_opp_last = {
  init(this: Blockly.Block) {
    this.jsonInit({
      message0: "opponent's last move was %1",
      args0: [{ ...moveField, options: moveOptions() }],
      output: 'Boolean',
      colour: AMBER,
      tooltip: 'What your opponent played last turn. False on the first turn',
    })
  },
}

Blockly.Blocks.ic_opp_rate = {
  init(this: Blockly.Block) {
    this.jsonInit({
      message0: 'opponent chose %1 %2 %3 %% of the time',
      args0: [
        { ...moveField, options: moveOptions() },
        { type: 'field_dropdown', name: 'OP', options: [['more than', 'GT'], ['less than', 'LT']] },
        { type: 'field_number', name: 'PERCENT', value: 50, min: 0, max: 100, precision: 1 },
      ],
      output: 'Boolean',
      colour: AMBER,
      tooltip: 'How often your opponent has played this move so far',
    })
  },
}

export function toolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: TOOLBOX.map(({ label, colour, blocks }) => ({ kind: 'category', name: label, colour, contents: blocks.map((type) => ({ kind: 'block', type })) })),
  }
}

export const theme = Blockly.Theme.defineTheme('iron', {
  name: 'iron',
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: '#0b0d0f',
    toolboxBackgroundColour: '#121518',
    toolboxForegroundColour: '#d9dde2',
    flyoutBackgroundColour: '#1a1e23',
    flyoutForegroundColour: '#d9dde2',
    flyoutOpacity: 0.96,
    scrollbarColour: '#3a424c',
    insertionMarkerColour: '#ffffff',
    insertionMarkerOpacity: 0.3,
    cursorColour: '#e5243b',
  },
  fontStyle: { family: 'JetBrains Mono, monospace', size: 11 },
})

export { Blockly }
export type { Layout } from './layout'
