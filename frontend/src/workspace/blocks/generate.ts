/**
 * Turns a saved block layout into Python, in the browser. It reads the layout
 * JSON only, so it needs neither Blockly nor the server, and it is safe on any
 * JSON a draft might hold: nothing from a layout reaches the Python unchecked.
 *
 * opp_last_move() and opp_defection_rate() are the engine's helpers, named in
 * the team plan. The rest of the helper list is still to come. Rounds 2 and 3
 * use only what a module receives, and their shape is a placeholder (see games.ts).
 */
import { blockSet } from './categories'
import { moduleName, topBlocks, type BlockState, type Layout } from './layout'

/** Problems stop a submit. Warnings are about a strategy that would still run but probably isn't what was meant. */
export type Generated = { name: string; code: string; problems: string[]; warnings: string[] }

const MAX_DEPTH = 100
const NAME = /^[a-z][a-z0-9_]{0,30}$/
const PYTHON_WORDS = new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'])
const RESERVED = new Set(['strategy', 'opp_last_move', 'opp_defection_rate', 'random', 'math', 'my_history', 'opp_history', 'role', 'amount'])
const TROOPS = 100
const EVEN_SPLIT = '[20, 20, 20, 20, 20]'

const percent = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) / 100 : 0
}

/** A whole number from a field. Anything else becomes the lowest value allowed. */
const whole = (value: unknown, low: number, high: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(Math.min(high, Math.max(low, n))) : low
}

/** True when every path through these blocks ends in a decision. */
function alwaysDecides(first: BlockState | undefined, depth = 0): boolean {
  let block = first
  while (block && depth <= MAX_DEPTH) {
    if (block.type === 'ic_play' || block.type === 'ic_send_troops' || block.type === 'ic_copy_split' || block.type === 'ic_send_percent') return true
    if (block.type === 'controls_ifelse' && alwaysDecides(block.inputs?.DO0?.block, depth + 1) && alwaysDecides(block.inputs?.ELSE?.block, depth + 1)) return true
    block = block.next?.block
    depth++
  }
  return false
}

function generateModule(layout: Layout, game: string): Generated {
  const set = blockSet(game)
  const allowed = new Set([...set.moves, ...Object.values(set.categories).flatMap((c) => c.blocks)])
  const problems: string[] = []
  const note = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem)
  }
  const usable = (block: BlockState) => {
    if (allowed.has(String(block.type))) return true
    note(`The '${String(block.type)}' block can't be used in this round.`)
    return false
  }
  const name = moduleName(layout)
  const top = topBlocks(layout)
  const root = top.find((b) => b.type === 'ic_module')
  if (!root) note('A module needs its module block.')
  if (top.length > 1) note('Some blocks are not attached to the module. Attach them or delete them.')
  if (!NAME.test(name) || PYTHON_WORDS.has(name)) note('Module names use lowercase letters, digits and _, start with a letter, and cannot be a Python word.')
  else if (RESERVED.has(name)) note(`'${name}' is a reserved name. Pick another module name.`)

  const condition = (block: BlockState | undefined): string => {
    if (!block || block.type === undefined) {
      note('An if block has no condition. Attach one.')
      return 'False'
    }
    if (!usable(block)) return 'False'
    switch (block.type) {
      case 'ic_opp_last':
        return `opp_last_move() == ${block.fields?.MOVE === 'C' ? '"C"' : '"D"'}`
      case 'ic_opp_rate':
        return `opp_defection_rate() ${block.fields?.OP === 'LT' ? '<' : '>'} ${percent(block.fields?.PERCENT)}`
      case 'ic_first_turn':
        return 'len(my_history) == 0'
      case 'ic_chance':
        return `random.random() < ${percent(block.fields?.PERCENT)}`
      case 'ic_opp_region':
        return `len(opp_history) > 0 and opp_history[-1][${whole(block.fields?.REGION, 1, 5) - 1}] > ${whole(block.fields?.TROOPS, 0, TROOPS)}`
      case 'ic_role':
        return `role == ${block.fields?.ROLE === 'return' ? '"return"' : '"send"'}`
      case 'ic_amount':
        return `amount > ${whole(block.fields?.POINTS, 0, 1_000_000)}`
      default:
        note(`The '${String(block.type)}' block can't be used here.`)
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
        lines.push(`${pad}return ${block.fields?.MOVE === 'D' ? '"D"' : '"C"'}`)
      } else if (block.type === 'ic_send_troops') {
        const split = [1, 2, 3, 4, 5].map((n) => whole(block?.fields?.[`R${n}`], 0, TROOPS))
        const total = split.reduce((a, b) => a + b, 0)
        if (total !== TROOPS) note(`A send troops block adds up to ${total}. It must add up to ${TROOPS}.`)
        lines.push(`${pad}return [${split.join(', ')}]`)
      } else if (block.type === 'ic_copy_split') {
        lines.push(`${pad}return opp_history[-1] if opp_history else ${EVEN_SPLIT}`)
      } else if (block.type === 'ic_send_percent') {
        lines.push(`${pad}return amount * ${whole(block.fields?.PERCENT, 0, 100)} // 100`)
      } else if (block.type === 'controls_ifelse') {
        lines.push(`${pad}if ${condition(block.inputs?.IF0?.block)}:`)
        const then = statements(block.inputs?.DO0?.block, indent + 1, depth + 1)
        lines.push(...(then.length ? then : [`${pad}    pass`]), `${pad}else:`)
        const otherwise = statements(block.inputs?.ELSE?.block, indent + 1, depth + 1)
        lines.push(...(otherwise.length ? otherwise : [`${pad}    pass`]))
      } else {
        note(`The '${String(block.type)}' block can't be used here.`)
      }
      block = block.next?.block
      depth++
    }
    return lines
  }

  const body = statements(root?.inputs?.BODY?.block, 1, 1)
  const safeName = NAME.test(name) ? name : 'module'
  const warnings = alwaysDecides(root?.inputs?.BODY?.block) ? [] : ['Some situations reach no move, so this module gives back nothing there. Fill every branch.']
  return { name, problems, warnings, code: [`def ${safeName}(${set.args}):`, ...(body.length ? body : ['    return None'])].join('\n') + '\n' }
}

export function generateModules(layouts: Layout[], game = 'prisoners_dilemma'): Generated[] {
  const generated = layouts.map((layout) => generateModule(layout, game))
  for (const module of generated) {
    if (generated.filter((m) => m.name === module.name).length > 1) module.problems.push(`Two modules are named '${module.name}'. Rename one.`)
  }
  return generated
}

/**
 * The one file the server receives. Blocks go after the team's code, so line
 * numbers in the server's errors still match strategy.py. Python only needs
 * them defined by the time strategy() is called.
 */
export function assemble(handCode: string, modules: Generated[]): string {
  if (modules.length === 0) return handCode
  const usesRandom = modules.some((m) => m.code.includes('random.'))
  const parts = [handCode.trimEnd(), ...(usesRandom ? ['import random'] : []), ...modules.map((m) => m.code.trimEnd())]
  return `${parts.join('\n\n')}\n`
}
