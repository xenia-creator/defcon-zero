/**
 * Turns a saved block layout into Python, in the browser. It reads the layout
 * JSON only, so it needs neither Blockly nor the server, and it is safe on any
 * JSON a draft might hold: nothing from a layout reaches the Python unchecked.
 *
 * The Python uses only what a bot receives, my_history and opp_history, so it
 * doesn't rely on the engine providing any helper functions.
 *
 * Every path through generated code returns a legal move: a path that reaches
 * no move ends with a fallback, so nothing ever returns None.
 */
import { UNTIL_ROUND_ARRIVES } from '../editor/games'
import { FA_MISPLACED, FA_TOOLBOX, MODULE_ARGS, TOOLBOX, moveLabel } from './categories'
import { moduleName, slotValue, topBlocks, type BlockState, type Layout } from './layout'

/** Problems stop a submit. There is nothing to warn about: every path ends in a legal move. */
export type Generated = { name: string; code: string; problems: string[] }

/** The whole strategy.py from a strategy block, and what stops it being submitted. */
export type GeneratedStrategy = { code: string; problems: string[] }

/** What the generator reads from the round's config. Round['config'] fits as it is. */
export type StrategyConfig = { moves: string[]; endowment?: number; multiplier?: number }

const MAX_DEPTH = 100
const NAME = /^[a-z][a-z0-9_]{0,30}$/
const PYTHON_WORDS = new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'])
const RESERVED = new Set(['strategy', 'random', 'math', 'my_history', 'opp_history'])
const ALLOWED = new Set(TOOLBOX.flatMap((group) => group.blocks))

/** Separates a team's code from the Python made from its blocks, so a stored version can be reopened. */
const BLOCKS_MARKER = '# --- block modules ---'

const percent = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) / 100 : 0
}

/** True when every path through these blocks ends in a decision, so a fallback after them could never run. */
function alwaysDecides(first: BlockState | undefined, depth = 0): boolean {
  let block = first
  while (block && depth <= MAX_DEPTH) {
    if (block.type === 'ic_play') return true
    if (block.type === 'controls_ifelse' && alwaysDecides(block.inputs?.DO0?.block, depth + 1) && alwaysDecides(block.inputs?.ELSE?.block, depth + 1)) return true
    block = block.next?.block
    depth++
  }
  return false
}

/**
 * Round 1's blocks as Python statements. Shared by Write-code modules and the strategy block,
 * so both read every block the same way.
 */
function moveBlocks(moves: string[], note: (problem: string) => void) {
  const usable = (block: BlockState) => {
    if (ALLOWED.has(String(block.type))) return true
    note(`The '${String(block.type)}' block can't be used here.`)
    return false
  }
  /** A move as Python text. Only this round's moves get through. */
  const move = (value: unknown) => {
    if (moves.includes(String(value))) return JSON.stringify(String(value))
    note(`A block uses a move that isn't in this round. The moves are: ${moves.map(moveLabel).join(', ')}.`)
    return JSON.stringify(moves[0] ?? 'C')
  }

  const condition = (block: BlockState | undefined, missing: string, depth: number): string => {
    if (depth > MAX_DEPTH) {
      note('Blocks are nested too deeply.')
      return 'False'
    }
    if (!block || block.type === undefined) {
      note(missing)
      return 'False'
    }
    if (!usable(block)) return 'False'
    switch (block.type) {
      case 'ic_opp_last':
        return `len(opp_history) > 0 and opp_history[-1] == ${move(block.fields?.MOVE)}`
      case 'ic_opp_ever':
        return `${move(block.fields?.MOVE)} in opp_history`
      case 'ic_opp_rate':
        return `opp_history.count(${move(block.fields?.MOVE)}) ${block.fields?.OP === 'LT' ? '<' : '>'} ${percent(block.fields?.PERCENT)} * len(opp_history)`
      case 'ic_my_last':
        return `len(my_history) > 0 and my_history[-1] == ${move(block.fields?.MOVE)}`
      case 'ic_first_turn':
        return 'len(my_history) == 0'
      case 'ic_chance':
        return `random.random() < ${percent(block.fields?.PERCENT)}`
      case 'logic_operation': {
        const joiner = block.fields?.OP === 'OR' ? 'or' : 'and'
        const slot = `An "${joiner}" block needs a condition on both sides.`
        return `(${condition(block.inputs?.A?.block, slot, depth + 1)} ${joiner} ${condition(block.inputs?.B?.block, slot, depth + 1)})`
      }
      case 'logic_negate':
        return `not (${condition(block.inputs?.BOOL?.block, 'A "not" block needs a condition inside.', depth + 1)})`
      default:
        note(`The '${String(block.type)}' block can't be used as a condition.`)
        return 'False'
    }
  }

  const statements = (first: BlockState | undefined, indent: number, depth: number): string[] => {
    const pad = '    '.repeat(indent)
    const lines: string[] = []
    let block = first
    while (block) {
      if (depth > MAX_DEPTH) {
        note('Blocks are nested too deeply.')
        break
      }
      if (!usable(block)) {
        // reported; the rest of the chain is still read
      } else if (block.type === 'ic_play') {
        lines.push(`${pad}return ${move(block.fields?.MOVE)}`)
      } else if (block.type === 'ic_if' || block.type === 'controls_ifelse') {
        lines.push(`${pad}if ${condition(block.inputs?.IF0?.block, 'An if block has no condition. Attach one.', depth + 1)}:`)
        const then = statements(block.inputs?.DO0?.block, indent + 1, depth + 1)
        lines.push(...(then.length ? then : [`${pad}    pass`]))
        // An empty "otherwise" is left out
        const otherwise = block.type === 'controls_ifelse' ? statements(block.inputs?.ELSE?.block, indent + 1, depth + 1) : []
        if (otherwise.length) lines.push(`${pad}else:`, ...otherwise)
      } else {
        note(`The '${String(block.type)}' block can't be used here.`)
      }
      block = block.next?.block
      depth++
    }
    return lines
  }

  return { move, statements }
}

function generateModule(layout: Layout, moves: string[]): Generated {
  const problems: string[] = []
  const note = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem)
  }
  const name = moduleName(layout)
  const top = topBlocks(layout)
  const root = top.find((b) => b.type === 'ic_module')
  if (!root) note('A module needs its module block.')
  if (top.length > 1) note('Some blocks are not attached to the module. Attach them or delete them.')
  if (!NAME.test(name) || PYTHON_WORDS.has(name)) note('Module names use lowercase letters, digits and _, start with a letter, and cannot be a Python word.')
  else if (RESERVED.has(name)) note(`'${name}' is a reserved name. Pick another module name.`)

  const { statements } = moveBlocks(moves, note)
  const first = root?.inputs?.BODY?.block
  const body = statements(first, 1, 1)
  if (!alwaysDecides(first)) {
    // moves[0] is always legal in this round
    if (moves.length === 0) note('This round has no moves to play with blocks.')
    body.push('    # No block above decided, so play the safe default', `    return ${JSON.stringify(moves[0] ?? 'C')}`)
  }
  const safeName = NAME.test(name) ? name : 'module'
  return { name, problems, code: [`def ${safeName}(${MODULE_ARGS}):`, ...body].join('\n') + '\n' }
}

export function generateModules(layouts: Layout[], moves: string[]): Generated[] {
  const generated = layouts.map((layout) => generateModule(layout, moves))
  for (const module of generated) {
    if (generated.filter((m) => m.name === module.name).length > 1) module.problems.push(`Two modules are named '${module.name}'. Rename one.`)
  }
  return generated
}

/** Round 1: the whole strategy.py from the ic_strategy block. */
function prisonersDilemmaStrategy(layout: Layout, moves: string[]): GeneratedStrategy {
  const problems: string[] = []
  const note = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem)
  }
  const top = topBlocks(layout)
  const root = top.find((b) => b.type === 'ic_strategy')
  if (!root) note('Your strategy block is missing. Start again from an example.')
  if (top.length > 1) note('Some blocks are outside your strategy block. Put them inside it or delete them.')
  if (moves.length === 0) note('This round has no moves to play with blocks.')

  const { move, statements } = moveBlocks(moves, note)
  const first = root?.inputs?.BODY?.block
  const body = statements(first, 1, 1)
  if (!alwaysDecides(first)) body.push('    # If nothing above decided', `    return ${move(root?.fields?.FALLBACK ?? moves[0])}`)
  const fn = [`def strategy(${MODULE_ARGS}):`, ...body].join('\n')
  return { problems, code: `${fn.includes('random.') ? 'import random\n\n\n' : ''}${fn}\n` }
}

// --- Round 3: Foreign Aid ---------------------------------------------------------------------
//
// The bot gets only the two histories, not the config, so ENDOWMENT and MULTIPLIER are written into
// the file. Every amount goes through legal_send or legal_return, so any number a team builds becomes
// a legal whole number. Helper names avoid a leading _ (the sandbox bans those attributes), and only
// random is imported.

const FA_ALLOWED = new Set(FA_TOOLBOX.flatMap((group) => group.blocks))

const FA_HEADER = `def legal_send(amount):
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
    return my_sent, my_returned, opp_sent, opp_returned`

/** Added only when a block needs them, in this order. */
const FA_HELPERS = {
  average: `def average(values):
    """The average, or 0 when there is nothing yet."""
    return sum(values) / len(values) if values else 0`,
  return_rate: `def return_rate(opp_returned, my_sent):
    """What % of what they received the opponent sent back. 0 until they have had something to send back."""
    received = MULTIPLIER * sum(my_sent[:len(opp_returned)])
    return 100 * sum(opp_returned) / received if received > 0 else 0`,
  ever_short_changed: `def ever_short_changed(my_sent, opp_returned):
    """True if the opponent ever sent back less than I sent them."""
    return any(back < sent for sent, back in zip(my_sent, opp_returned))`,
  divide: `def divide(a, b):
    """a divided by b, or 0 when b is 0."""
    return a / b if b != 0 else 0`,
}
type Helper = keyof typeof FA_HELPERS

const COMPARE: Record<string, string> = { GT: '>', LT: '<', GTE: '>=', LTE: '<=', EQ: '==' }
const ARITH: Record<string, string> = { ADD: '+', SUB: '-', MUL: '*' }

/** A whole number from a field, kept in range. Anything else becomes the fallback. */
function wholeField(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback
}

/** A config number written into the Python: only a positive whole number gets through. */
const configNumber = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : fallback)

type Section = 'SEND' | 'RECEIVE'

function foreignAidStrategy(layout: Layout, config: StrategyConfig): GeneratedStrategy {
  const endowment = configNumber(config.endowment, UNTIL_ROUND_ARRIVES.endowment)
  const multiplier = configNumber(config.multiplier, UNTIL_ROUND_ARRIVES.multiplier)
  const problems: string[] = []
  const note = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem)
  }
  const helpers = new Set<Helper>()
  let usesRandom = false

  const top = topBlocks(layout)
  const root = top.find((b) => b.type === 'fa_strategy')
  if (!root) note('Your strategy block is missing. Start again from an example.')
  if (top.length > 1) note('Some blocks are outside your strategy block. Put them inside it or delete them.')

  const usable = (block: BlockState) => {
    if (FA_ALLOWED.has(String(block.type))) return true
    note(`The '${String(block.type)}' block can't be used here.`)
    return false
  }
  const tooDeep = (depth: number) => {
    if (depth <= MAX_DEPTH) return false
    note('Blocks are nested too deeply.')
    return true
  }

  /** A number as Python. A missing one is reported and stands in as 0, so the file still runs. */
  const value = (block: BlockState | undefined, section: Section, missing: string, depth: number): string => {
    if (tooDeep(depth)) return '0'
    if (!block || block.type === undefined) {
      note(missing)
      return '0'
    }
    if (!usable(block)) return '0'
    const inner = (slot: string, why: string) => value(slotValue(block.inputs?.[slot]), section, why, depth + 1)
    switch (block.type) {
      case 'fa_number':
        return String(wholeField(block.fields?.NUM, 0, 100, 0))
      case 'fa_opp_sent_last':
        return '(opp_sent[-1] if opp_sent else 0)'
      case 'fa_opp_returned_last':
        return '(opp_returned[-1] if opp_returned else 0)'
      case 'fa_opp_avg':
        if (block.fields?.WHAT === 'RETURN_PCT') {
          helpers.add('return_rate')
          return 'return_rate(opp_returned, my_sent)'
        }
        helpers.add('average')
        return 'average(opp_sent)'
      case 'fa_received':
        if (section === 'RECEIVE') return 'received'
        note(FA_MISPLACED.receivedInSend)
        return '0'
      case 'fa_my_last':
        return block.fields?.WHAT === 'RETURN' ? '(my_returned[-1] if my_returned else 0)' : '(my_sent[-1] if my_sent else 0)'
      case 'fa_turn':
        return '(len(my_history) + 1)'
      case 'fa_arith': {
        const why = 'A maths block needs a number on both sides. Drag one in from Numbers.'
        const [a, b] = [inner('A', why), inner('B', why)]
        if (block.fields?.OP === 'DIV') {
          // a helper, so a random number on the right is drawn once: "b if b != 0" would draw it twice
          helpers.add('divide')
          return `divide(${a}, ${b})`
        }
        return `(${a} ${ARITH[String(block.fields?.OP)] ?? '+'} ${b})`
      }
      case 'fa_percent_of':
        return `(${wholeField(block.fields?.PERCENT, 0, 100, 0)} / 100 * ${inner('X', "The '% of' block needs a number. Drag one in from Numbers.")})`
      case 'fa_random': {
        const [from, to] = [wholeField(block.fields?.FROM, 0, 100, 0), wholeField(block.fields?.TO, 0, 100, 0)]
        usesRandom = true
        return `random.randint(${Math.min(from, to)}, ${Math.max(from, to)})`
      }
      default:
        note(`The '${String(block.type)}' block can't be used as a number.`)
        return '0'
    }
  }

  const condition = (block: BlockState | undefined, section: Section, missing: string, depth: number): string => {
    if (tooDeep(depth)) return 'False'
    if (!block || block.type === undefined) {
      note(missing)
      return 'False'
    }
    if (!usable(block)) return 'False'
    switch (block.type) {
      case 'fa_compare': {
        const why = 'A comparison needs a number on both sides. Drag one in from Numbers.'
        return `(${value(slotValue(block.inputs?.A), section, why, depth + 1)} ${COMPARE[String(block.fields?.OP)] ?? '>'} ${value(slotValue(block.inputs?.B), section, why, depth + 1)})`
      }
      case 'fa_opp_ever_short':
        helpers.add('ever_short_changed')
        return 'ever_short_changed(my_sent, opp_returned)'
      case 'fa_first_time':
        return section === 'SEND' ? 'len(my_sent) == 0' : 'len(my_returned) == 0'
      case 'ic_chance':
        usesRandom = true
        return `random.random() < ${percent(block.fields?.PERCENT)}`
      case 'logic_operation': {
        const joiner = block.fields?.OP === 'OR' ? 'or' : 'and'
        const slot = `An "${joiner}" block needs a condition on both sides.`
        return `(${condition(block.inputs?.A?.block, section, slot, depth + 1)} ${joiner} ${condition(block.inputs?.B?.block, section, slot, depth + 1)})`
      }
      case 'logic_negate':
        return `not (${condition(block.inputs?.BOOL?.block, section, 'A "not" block needs a condition inside.', depth + 1)})`
      default:
        note(`The '${String(block.type)}' block can't be used as a condition.`)
        return 'False'
    }
  }

  /** The section's statements, and whether every path through them already decides. */
  const statements = (first: BlockState | undefined, section: Section, indent: number, depth: number): { lines: string[]; decides: boolean } => {
    const pad = '    '.repeat(indent)
    const lines: string[] = []
    let decides = false
    let block = first
    while (block && !decides) {
      if (tooDeep(depth)) break
      if (!usable(block)) {
        // reported; the rest of the chain is still read
      } else if (block.type === 'fa_send') {
        if (section === 'SEND') {
          lines.push(`${pad}return legal_send(${value(slotValue(block.inputs?.AMOUNT), section, 'The send block needs a number. Drag one in from Numbers.', depth + 1)})`)
          decides = true
        } else note(FA_MISPLACED.sendInReceive)
      } else if (block.type === 'fa_return' || block.type === 'fa_return_pct') {
        if (section === 'RECEIVE') {
          const amount =
            block.type === 'fa_return'
              ? value(slotValue(block.inputs?.AMOUNT), section, 'The send back block needs a number. Drag one in from Numbers.', depth + 1)
              : `received * ${wholeField(block.fields?.PERCENT, 0, 100, 0)} // 100`
          lines.push(`${pad}return legal_return(${amount}, received)`)
          decides = true
        } else note(FA_MISPLACED.returnInSend)
      } else if (block.type === 'ic_if' || block.type === 'controls_ifelse') {
        lines.push(`${pad}if ${condition(block.inputs?.IF0?.block, section, 'An if block has no condition. Attach one.', depth + 1)}:`)
        const then = statements(block.inputs?.DO0?.block, section, indent + 1, depth + 1)
        lines.push(...(then.lines.length ? then.lines : [`${pad}    pass`]))
        // An empty "otherwise" is left out
        const otherwise = block.type === 'controls_ifelse' ? statements(block.inputs?.ELSE?.block, section, indent + 1, depth + 1) : { lines: [], decides: false }
        if (otherwise.lines.length) lines.push(`${pad}else:`, ...otherwise.lines)
        decides = then.decides && otherwise.decides
      } else {
        note(`The '${String(block.type)}' block can't be used here.`)
      }
      block = block.next?.block
      depth++
    }
    // Blocks under a decision never run, but they are still checked, so a mistake there is reported too
    if (block && decides) statements(block, section, indent, depth)
    return { lines, decides }
  }

  const send = statements(root?.inputs?.SEND?.block, 'SEND', 2, 1)
  const receive = statements(root?.inputs?.RECEIVE?.block, 'RECEIVE', 1, 1)
  const sendDefault = wholeField(root?.fields?.SEND_DEFAULT, 0, endowment, Math.min(5, endowment))
  const returnPct = wholeField(root?.fields?.RETURN_PCT_DEFAULT, 0, 100, 50)

  const fn = [
    `def strategy(${MODULE_ARGS}):`,
    '    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)',
    '    if len(opp_history) == len(my_history):',
    "        # When I'm sending",
    ...send.lines,
    ...(send.decides ? [] : ['        # If nothing above decided', `        return legal_send(${sendDefault})`]),
    "    # When I'm receiving: the opponent just sent opp_history[-1]",
    '    received = MULTIPLIER * opp_history[-1]',
    ...receive.lines,
    ...(receive.decides ? [] : ['    # If nothing above decided', `    return legal_return(received * ${returnPct} // 100, received)`]),
  ].join('\n')

  const parts = [
    ...(usesRandom ? ['import random'] : []),
    `ENDOWMENT = ${endowment}  # the most you can send (config.endowment)\nMULTIPLIER = ${multiplier}  # what you send arrives multiplied by this (config.multiplier)`,
    FA_HEADER,
    ...(Object.keys(FA_HELPERS) as Helper[]).filter((h) => helpers.has(h)).map((h) => FA_HELPERS[h]),
    fn,
  ]
  return { problems, code: `${parts.join('\n\n\n')}\n` }
}

/** The whole strategy.py from a strategy block, for blocks mode. `config` is the round's config. */
export function generateStrategy(layout: Layout, game: string, config: StrategyConfig): GeneratedStrategy {
  if (game === 'prisoners_dilemma') return prisonersDilemmaStrategy(layout, config.moves)
  if (game === 'foreign_aid') return foreignAidStrategy(layout, config)
  return { code: '', problems: ["This round doesn't use blocks. Write code instead."] }
}

/**
 * The one file the server receives. Blocks go after the team's code, so line
 * numbers in the server's errors still match strategy.py. Python only needs
 * them defined by the time strategy() is called.
 */
export function assemble(handCode: string, modules: Generated[]): string {
  if (modules.length === 0) return handCode
  const usesRandom = modules.some((m) => m.code.includes('random.'))
  const parts = [handCode.trimEnd(), BLOCKS_MARKER, ...(usesRandom ? ['import random'] : []), ...modules.map((m) => m.code.trimEnd())]
  return `${parts.join('\n\n')}\n`
}

/** The team's own code from a stored version, for reopening it. The blocks come back separately. */
export function handCodeOf(code: string): string {
  const at = code.indexOf(`\n${BLOCKS_MARKER}`)
  return at === -1 ? code : `${code.slice(0, at).trimEnd()}\n`
}
