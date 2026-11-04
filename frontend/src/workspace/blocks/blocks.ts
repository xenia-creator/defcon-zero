/**
 * Blockly setup: the custom blocks, a toolbox filtered by the round's allowed
 * categories, and a theme matching the app. generate.ts turns layouts into Python.
 */
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import * as En from 'blockly/msg/en'

Blockly.setLocale(En as unknown as Record<string, string>)
// Easier to drop a block into its slot than the default, which needs a close aim
Blockly.config.snapRadius = 48
Blockly.config.connectingSnapRadius = 68

import { AMBER, RED, TEAL, blockSet } from './categories'

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

const MOVES = [['cooperate', 'C'], ['betray', 'D']]

Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'ic_module',
    message0: 'module %1 %2 %3',
    args0: [{ type: 'field_input', name: 'NAME', text: 'my_module' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'BODY' }],
    colour: RED,
    extensions: ['ic_module_name'],
    tooltip: 'A helper your strategy can call',
  },
  {
    type: 'ic_play',
    message0: 'play %1',
    args0: [{ type: 'field_dropdown', name: 'MOVE', options: MOVES }],
    previousStatement: null,
    colour: RED,
    tooltip: 'Give back this move and stop the module',
  },
  {
    type: 'ic_opp_last',
    message0: "opponent's last move was %1",
    args0: [{ type: 'field_dropdown', name: 'MOVE', options: [['betray', 'D'], ['cooperate', 'C']] }],
    output: 'Boolean',
    colour: AMBER,
    tooltip: 'What your opponent played last turn',
  },
  {
    type: 'ic_opp_rate',
    message0: 'opponent betrays %1 %2 %% of the time',
    args0: [
      { type: 'field_dropdown', name: 'OP', options: [['more than', 'GT'], ['less than', 'LT']] },
      { type: 'field_number', name: 'PERCENT', value: 50, min: 0, max: 100, precision: 1 },
    ],
    output: 'Boolean',
    colour: AMBER,
    tooltip: 'How often your opponent has betrayed so far',
  },
  {
    type: 'ic_send_troops',
    message0: 'send troops %1 %2 %3 %4 %5',
    args0: [1, 2, 3, 4, 5].map((n) => ({ type: 'field_number', name: `R${n}`, value: 20, min: 0, max: 100, precision: 1 })),
    previousStatement: null,
    colour: RED,
    tooltip: 'Troops for regions 1 to 5. They must add up to 100',
  },
  {
    type: 'ic_copy_split',
    message0: "copy opponent's last split",
    previousStatement: null,
    colour: RED,
    tooltip: "Play your opponent's last split. On the first battle this sends 20 to each region",
  },
  {
    type: 'ic_opp_region',
    message0: 'opponent last sent more than %1 to region %2',
    args0: [
      { type: 'field_number', name: 'TROOPS', value: 30, min: 0, max: 100, precision: 1 },
      { type: 'field_dropdown', name: 'REGION', options: ['1', '2', '3', '4', '5'].map((n) => [n, n]) },
    ],
    output: 'Boolean',
    colour: AMBER,
    tooltip: "Checks your opponent's last split",
  },
  {
    type: 'ic_send_percent',
    message0: 'send %1 %% of the amount',
    args0: [{ type: 'field_number', name: 'PERCENT', value: 50, min: 0, max: 100, precision: 1 }],
    previousStatement: null,
    colour: RED,
    tooltip: 'When sending, the amount is what you can send. When returning, it is what arrived after tripling',
  },
  {
    type: 'ic_role',
    message0: 'my role is %1',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: [['sender', 'send'], ['receiver', 'return']] }],
    output: 'Boolean',
    colour: AMBER,
    tooltip: 'Roles alternate each turn',
  },
  {
    type: 'ic_amount',
    message0: 'the amount is more than %1',
    args0: [{ type: 'field_number', name: 'POINTS', value: 50, min: 0, precision: 1 }],
    output: 'Boolean',
    colour: AMBER,
    tooltip: 'How many points you are deciding about this turn',
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

export function toolbox(categories: string[], game: string): Blockly.utils.toolbox.ToolboxDefinition {
  const set = blockSet(game)
  const category = (name: string, colour: string, types: string[]) => ({
    kind: 'category',
    name,
    colour,
    contents: types.map((type) => ({ kind: 'block', type })),
  })
  return {
    kind: 'categoryToolbox',
    contents: [
      category('Moves', RED, set.moves),
      ...categories.filter((c) => set.categories[c]).map((c) => category(set.categories[c].label, set.categories[c].colour, set.categories[c].blocks)),
    ],
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
