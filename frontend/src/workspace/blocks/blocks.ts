/**
 * Blockly setup: the blocks, the toolbox, and a theme matching the app.
 * generate.ts turns layouts into Python.
 */
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import * as En from 'blockly/msg/en'

Blockly.setLocale(En as unknown as Record<string, string>)
// Easier to drop a block into its slot than the default, which needs a close aim
Blockly.config.snapRadius = 48
Blockly.config.connectingSnapRadius = 68

import { CATEGORY, FA_MISPLACED, movePast, moveLabel, toolboxFor } from './categories'

// The built-in blocks (controls_ifelse, logic_operation, logic_negate) take their text from here
Object.assign(Blockly.Msg, {
  CONTROLS_IF_MSG_IF: 'if',
  CONTROLS_IF_MSG_THEN: 'then',
  CONTROLS_IF_MSG_ELSE: 'otherwise',
  CONTROLS_IF_TOOLTIP_2: 'If this is true, do the first blocks, otherwise the second.',
  LOGIC_OPERATION_AND: 'and',
  LOGIC_OPERATION_OR: 'or',
  LOGIC_OPERATION_TOOLTIP_AND: '"and": both must be true.',
  LOGIC_OPERATION_TOOLTIP_OR: '"or": at least one must be true.',
  LOGIC_NEGATE_TITLE: 'not %1',
  LOGIC_NEGATE_TOOLTIP: 'True when the condition inside is false.',
})

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
const moveDropdown = (name = 'MOVE') => ({ type: 'field_dropdown', name, options: roundMoves.map((move) => [moveLabel(move), move]) })
const pastDropdown = () => ({ type: 'field_dropdown', name: 'MOVE', options: roundMoves.map((move) => [movePast(move), move]) })
const percentField = (value: number) => ({ type: 'field_number', name: 'PERCENT', value, min: 0, max: 100, precision: 1 })

/** Block styles are named after their category, so the toolbox and the blocks always agree. */
const style = (category: keyof typeof CATEGORY) => `dz_${category}`

/** Round 3's most a bot can send (config.endowment). Read when a block is made, like the moves. */
let roundEndowment = 10
export function setBlockEndowment(endowment: number) {
  roundEndowment = endowment
}

/**
 * Each block defined with an init, so the dropdowns and limits read the round's config when the block is made.
 * `onchange` runs on every change in the workspace, for blocks that react to where they sit.
 */
const define = (type: string, json: () => Record<string, unknown>, onchange?: (this: Blockly.BlockSvg) => void) => {
  Blockly.Blocks[type] = {
    init(this: Blockly.Block) {
      this.jsonInit(json())
    },
    ...(onchange ? { onchange } : {}),
  }
}

// Write-code mode only: a named helper the team's code calls
define('ic_module', () => ({
  message0: 'module %1 %2 %3',
  args0: [{ type: 'field_input', name: 'NAME', text: 'my_module' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'BODY' }],
  style: style('actions'),
  extensions: ['ic_module_name'],
  tooltip: 'A helper your strategy can call',
}))

define('ic_strategy', () => ({
  message0: 'My strategy, every turn: %1 %2',
  args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'BODY' }],
  message1: 'if nothing above decided, play %1',
  args1: [moveDropdown('FALLBACK')],
  style: style('actions'),
  tooltip: 'Your bot runs these blocks from the top every turn. The first move it reaches is the one it plays.',
}))

define('ic_play', () => ({
  message0: 'play %1',
  args0: [moveDropdown()],
  previousStatement: null,
  style: style('actions'),
  tooltip: 'Play this move this turn. Blocks under it are skipped.',
}))

define('ic_if', () => ({
  message0: 'if %1',
  args0: [{ type: 'input_value', name: 'IF0', check: 'Boolean' }],
  message1: 'then %1',
  args1: [{ type: 'input_statement', name: 'DO0' }],
  previousStatement: null,
  nextStatement: null,
  style: 'logic_blocks',
  tooltip: 'If this is true, do the blocks inside. Otherwise carry on below.',
}))

define('ic_opp_last', () => ({
  message0: 'opponent %1 last turn',
  args0: [pastDropdown()],
  output: 'Boolean',
  style: style('opponent'),
  tooltip: 'What the opponent played last turn. False on the first turn.',
}))

define('ic_opp_ever', () => ({
  message0: 'opponent has ever %1',
  args0: [pastDropdown()],
  output: 'Boolean',
  style: style('opponent'),
  tooltip: 'True once the opponent has played this move even once in this match.',
}))

define('ic_opp_rate', () => ({
  message0: 'opponent has %1 %2 %3 %% of the time',
  args0: [pastDropdown(), { type: 'field_dropdown', name: 'OP', options: [['more than', 'GT'], ['less than', 'LT']] }, percentField(50)],
  output: 'Boolean',
  style: style('opponent'),
  tooltip: 'How often the opponent has played this move so far. False on the first turn.',
}))

define('ic_my_last', () => ({
  message0: 'I %1 last turn',
  args0: [pastDropdown()],
  output: 'Boolean',
  style: style('me'),
  tooltip: 'What you played last turn. False on the first turn.',
}))

define('ic_first_turn', () => ({
  message0: 'this is the first turn',
  output: 'Boolean',
  style: style('me'),
  tooltip: 'True only on the first turn of a match, before anyone has moved.',
}))

define('ic_chance', () => ({
  message0: '%1 %% chance',
  args0: [percentField(10)],
  output: 'Boolean',
  style: style('chance'),
  tooltip: 'True this often, at random. 10 % means about 1 turn in 10.',
}))

// --- Round 3: Foreign Aid -------------------------------------------------------------------

/** The section of the Round 3 strategy block a block sits in ('SEND' or 'RECEIVE'), or null when it is loose. */
export function sectionOf(block: Blockly.Block): string | null {
  let child = block
  let parent = child.getParent()
  while (parent) {
    if (parent.type === 'fa_strategy') return parent.getInputWithBlock(child)?.name ?? null
    child = parent
    parent = child.getParent()
  }
  return null
}

/** A warning icon on the block itself while it sits in the section where it can't work. The generator reports the same words. */
const warnIn = (section: 'SEND' | 'RECEIVE', message: string) =>
  function (this: Blockly.BlockSvg) {
    // Only a block drawn on screen has a warning icon
    if (!(this instanceof Blockly.BlockSvg) || this.isInFlyout) return
    const wrong = sectionOf(this) === section
    if (wrong !== Boolean(this.getIcon(Blockly.icons.IconType.WARNING))) this.setWarningText(wrong ? message : null)
  }

const numberSlot = (name: string) => ({ type: 'input_value', name, check: 'Number' })
const whole = (name: string, value: number, max = 100) => ({ type: 'field_number', name, value, min: 0, max, precision: 1 })

define('fa_strategy', () => ({
  message0: 'My strategy %1',
  args0: [{ type: 'input_dummy' }],
  message1: "when I'm sending: %1",
  args1: [{ type: 'input_statement', name: 'SEND' }],
  message2: 'if nothing above decided, send %1',
  args2: [whole('SEND_DEFAULT', Math.min(5, roundEndowment), roundEndowment)],
  message3: "when I'm receiving: %1",
  args3: [{ type: 'input_statement', name: 'RECEIVE' }],
  message4: 'if nothing above decided, send back %1 %% of what I received',
  args4: [whole('RETURN_PCT_DEFAULT', 50)],
  style: style('actions'),
  tooltip: 'Each turn you are either sending or receiving, and it alternates. Your bot runs the section for its role this turn.',
}))

define(
  'fa_send',
  () => ({
    message0: 'send %1',
    args0: [numberSlot('AMOUNT')],
    previousStatement: null,
    style: style('actions'),
    tooltip: `Send this amount and stop. Kept between 0 and ${roundEndowment} and rounded down to a whole number. Only under "when I'm sending".`,
  }),
  warnIn('RECEIVE', FA_MISPLACED.sendInReceive),
)

define(
  'fa_return',
  () => ({
    message0: 'send back %1',
    args0: [numberSlot('AMOUNT')],
    previousStatement: null,
    style: style('actions'),
    tooltip: 'Send back this amount and stop. Kept between 0 and what you received, rounded down. Only under "when I\'m receiving".',
  }),
  warnIn('SEND', FA_MISPLACED.returnInSend),
)

define(
  'fa_return_pct',
  () => ({
    message0: 'send back %1 %% of what I received',
    args0: [percentField(50)],
    previousStatement: null,
    style: style('actions'),
    tooltip: 'Send back this share of what arrived. 34 % or more means the sender doesn\'t lose. Only under "when I\'m receiving".',
  }),
  warnIn('SEND', FA_MISPLACED.returnInSend),
)

define('fa_opp_sent_last', () => ({
  message0: 'what the opponent sent last',
  output: 'Number',
  style: style('opponent'),
  tooltip: "When receiving, what they just sent you. When sending, what they sent on their last turn as sender. 0 if they haven't sent yet.",
}))

define('fa_opp_returned_last', () => ({
  message0: 'what the opponent sent back last',
  output: 'Number',
  style: style('opponent'),
  tooltip: "What they sent back the last time you sent to them. 0 if they haven't had the chance.",
}))

define('fa_opp_avg', () => ({
  message0: "opponent's average %1",
  args0: [{ type: 'field_dropdown', name: 'WHAT', options: [['send', 'SEND'], ['send-back %', 'RETURN_PCT']] }],
  output: 'Number',
  style: style('opponent'),
  tooltip: '"send": the average they send. "send-back %": on average, what % of what they received they sent back. 0 before they\'ve done it.',
}))

define('fa_opp_ever_short', () => ({
  message0: 'the opponent has ever sent back less than I sent',
  output: 'Boolean',
  style: style('opponent'),
  tooltip: 'True once they have ever left you worse off for trusting them.',
}))

define(
  'fa_received',
  () => ({
    message0: 'what I received this turn',
    output: 'Number',
    style: style('me'),
    tooltip: 'What arrived this turn: the amount sent, times 3. Only under "when I\'m receiving".',
  }),
  warnIn('SEND', FA_MISPLACED.receivedInSend),
)

define('fa_my_last', () => ({
  message0: 'my last %1',
  args0: [{ type: 'field_dropdown', name: 'WHAT', options: [['send', 'SEND'], ['send-back', 'RETURN']] }],
  output: 'Number',
  style: style('me'),
  tooltip: "The amount you sent, or sent back, last time. 0 if you haven't yet.",
}))

define('fa_turn', () => ({
  message0: 'turn number',
  output: 'Number',
  style: style('me'),
  tooltip: 'Counts every turn in the match, sending and receiving, starting at 1.',
}))

define(
  'fa_first_time',
  () => ({
    message0: 'this is my first time %1',
    // A plain label, not saved: the word follows the section the block is in
    args0: [{ type: 'field_label', name: 'ROLE', text: 'sending' }],
    output: 'Boolean',
    style: style('me'),
    tooltip: 'True the first time you have this role in a match. The word follows the section the block is in.',
  }),
  function (this: Blockly.BlockSvg) {
    const word = sectionOf(this) === 'RECEIVE' ? 'receiving' : 'sending'
    const field = this.getField('ROLE')
    if (field && field.getValue() !== word) field.setValue(word)
  },
)

define('fa_compare', () => ({
  message0: '%1 %2 %3',
  args0: [
    numberSlot('A'),
    {
      type: 'field_dropdown',
      name: 'OP',
      options: [
        ['is more than', 'GT'],
        ['is less than', 'LT'],
        ['is at least', 'GTE'],
        ['is at most', 'LTE'],
        ['equals', 'EQ'],
      ],
    },
    numberSlot('B'),
  ],
  inputsInline: true,
  output: 'Boolean',
  style: 'logic_blocks',
  tooltip: 'Compares two numbers.',
}))

define('fa_number', () => ({
  message0: '%1',
  args0: [whole('NUM', 5)],
  output: 'Number',
  style: style('numbers'),
  tooltip: 'A whole number from 0 to 100.',
}))

define('fa_arith', () => ({
  message0: '%1 %2 %3',
  args0: [
    numberSlot('A'),
    {
      type: 'field_dropdown',
      name: 'OP',
      options: [
        ['+', 'ADD'],
        ['−', 'SUB'],
        ['×', 'MUL'],
        ['÷', 'DIV'],
      ],
    },
    numberSlot('B'),
  ],
  inputsInline: true,
  output: 'Number',
  style: style('numbers'),
  tooltip: 'Adds, takes away, multiplies or divides. Dividing by 0 gives 0.',
}))

define('fa_percent_of', () => ({
  message0: '%1 %% of %2',
  args0: [percentField(50), numberSlot('X')],
  inputsInline: true,
  output: 'Number',
  style: style('numbers'),
  tooltip: 'This percentage of a number, for example 50 % of 12 is 6.',
}))

define('fa_random', () => ({
  message0: 'random number from %1 to %2',
  args0: [whole('FROM', 0), whole('TO', 10)],
  output: 'Number',
  style: style('chance'),
  tooltip: 'A random whole number in this range, both ends included.',
}))

/**
 * Actions and maths arrive with numbers already in their slots, so a beginner never starts from an empty slot.
 * They are shadows: a value dropped on one replaces it cleanly, with no loose number left on the canvas.
 */
const number = (NUM: number) => ({ shadow: { type: 'fa_number', fields: { NUM } } })
const PREFILLED: Record<string, Record<string, unknown>> = {
  fa_send: { inputs: { AMOUNT: number(5) } },
  fa_return: { inputs: { AMOUNT: number(5) } },
  fa_compare: { inputs: { A: { block: { type: 'fa_opp_sent_last' } }, B: number(5) } },
  fa_arith: { inputs: { A: number(5), B: number(2) } },
  fa_percent_of: { inputs: { X: number(10) } },
}

// Category labels in the app's typewriter face. Blockly's theme has no font for the toolbox, so
// this one rule (a font, nothing else) is registered with Blockly and injected with its own CSS.
// Two classes, so it outranks index.css's mono rule for every label (Blockly puts its CSS first in <head>).
const LABEL_CLASS = 'dz-category-label'
Blockly.Css.register(`.blocklyToolboxCategoryLabel.${LABEL_CLASS} { font-family: 'Special Elite', 'Courier New', monospace; font-size: 15px; letter-spacing: 0.02em; }`)

/** The toolbox for this round's game. */
export function toolbox(game = 'prisoners_dilemma'): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: toolboxFor(game).map(({ id, label, blocks }) => ({
      kind: 'category',
      name: label,
      toolboxitemid: id,
      categorystyle: style(id as keyof typeof CATEGORY),
      // Blockly's own class stays first, so its layout rules still apply
      cssconfig: { label: `blocklyToolboxCategoryLabel ${LABEL_CLASS}` },
      contents: blocks.map((type) => ({ kind: 'block', type, ...PREFILLED[type] })),
    })),
  }
}

/** A darker shade of an ink, for block borders and the dropdowns inside a block. */
function shade(hex: string, amount: number): string {
  const channel = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
  return `#${[1, 3, 5].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`
}

const blockStyles: Record<string, Blockly.Theme.BlockStyle> = {}
const categoryStyles: Record<string, Blockly.Theme.CategoryStyle> = {}
for (const [key, { colour }] of Object.entries(CATEGORY)) {
  const ink = { colourPrimary: colour, colourSecondary: shade(colour, 0.2), colourTertiary: shade(colour, 0.35), hat: '' }
  blockStyles[style(key as keyof typeof CATEGORY)] = ink
  categoryStyles[style(key as keyof typeof CATEGORY)] = { colour }
}
// Blockly's own if/else, and/or and not use this style
blockStyles.logic_blocks = blockStyles[style('logic')]

/** The app's tokens (index.css): ink for the field, panel and steel for the kit around it, paper for type. */
const APP = { ink: '#0e1011', panel: '#191c1b', steel: '#2b302d', steelLight: '#4a514b', paper: '#d9d3c3', fire: '#d97a35' }

/**
 * The one font every block's text is drawn and measured in: Blockly sizes each field from this
 * (on a canvas) and draws the text with the same font through its own CSS. Nothing else may set
 * the font of .blocklyText, or the text and its box stop matching.
 */
export const BLOCK_FONT = { family: '"JetBrains Mono", monospace', weight: 'bold', size: 11 } as const
/** BLOCK_FONT as a CSS font, for loading it before Blockly measures. Blockly reads size in pt. */
export const BLOCK_FONT_CSS = `${BLOCK_FONT.weight} ${BLOCK_FONT.size}pt ${BLOCK_FONT.family}`

export const theme = Blockly.Theme.defineTheme('dz_field_kit', {
  name: 'dz_field_kit',
  base: Blockly.Themes.Classic,
  blockStyles,
  categoryStyles,
  componentStyles: {
    workspaceBackgroundColour: APP.ink,
    toolboxBackgroundColour: APP.steel,
    toolboxForegroundColour: APP.paper,
    flyoutBackgroundColour: APP.panel,
    flyoutForegroundColour: APP.paper,
    flyoutOpacity: 0.97,
    scrollbarColour: APP.steelLight,
    scrollbarOpacity: 0.6,
    insertionMarkerColour: APP.paper,
    insertionMarkerOpacity: 0.3,
    markerColour: APP.fire,
    cursorColour: APP.fire,
    selectedGlowColour: APP.fire,
  },
  fontStyle: BLOCK_FONT,
})

/** A faint grid on the field: the steel rule colour, drawn as full lines. */
export const GRID = { spacing: 24, length: 24, colour: APP.steel, snap: true }

export { Blockly }
export type { Layout } from './layout'
