import { beforeAll, describe, expect, it } from 'vitest'
import { gameInfo } from '../editor/games'
import { EXAMPLES, exampleBlocks, exampleLayout, examplesFor, matchingExample, strategyLayout } from './examples'
import { assemble, generateModules, generateStrategy, handCodeOf } from './generate'
import { newStrategy, type BlockState } from './layout'

const PD = ['C', 'D']

const moduleWith = (body: unknown, name = 'punish', extra: unknown[] = []) => ({
  blocks: { languageVersion: 0, blocks: [{ type: 'ic_module', fields: { NAME: name }, inputs: body ? { BODY: { block: body } } : {} }, ...extra] },
})
const strategyWith = (body: unknown, fallback = 'C', extra: unknown[] = []) => ({
  blocks: { languageVersion: 0, blocks: [{ type: 'ic_strategy', fields: { FALLBACK: fallback }, inputs: body ? { BODY: { block: body } } : {} }, ...extra] },
})
const one = (layout: Record<string, unknown>, moves = PD) => generateModules([layout], moves)[0]
const strategy = (layout: Record<string, unknown>, moves = PD) => generateStrategy(layout, 'prisoners_dilemma', { moves })

const play = (MOVE: string) => ({ type: 'ic_play', fields: { MOVE } })
const FALLBACK = '    # No block above decided, so play the safe default\n    return "C"\n'

describe('generating Python from block modules (Write code)', () => {
  it('writes an if/else from the histories alone, with no engine helpers', () => {
    const result = one(
      moduleWith({
        type: 'controls_ifelse',
        inputs: {
          IF0: { block: { type: 'ic_opp_rate', fields: { MOVE: 'D', OP: 'GT', PERCENT: 60 } } },
          DO0: { block: play('D') },
          ELSE: { block: play('C') },
        },
      }),
    )
    expect(result.problems).toEqual([])
    expect(result.code).toBe('def punish(my_history, opp_history):\n    if opp_history.count("D") > 0.6 * len(opp_history):\n        return "D"\n    else:\n        return "C"\n')
  })

  it('uses whichever moves the round has', () => {
    expect(one(moduleWith(play('EXPAND')), ['ATTACK', 'DEFEND', 'EXPAND']).code).toContain('return "EXPAND"')
    expect(one(moduleWith(play('WITHHOLD')), ['AID', 'WITHHOLD']).problems).toEqual([])
  })

  it("refuses a move that isn't in this round", () => {
    const result = one(moduleWith(play('ATTACK')))
    expect(result.problems[0]).toContain('cooperate, betray')
    expect(result.code).not.toContain('ATTACK')
  })

  it("an empty module plays the round's first move", () => {
    expect(one(moduleWith(null)).code).toBe(`def punish(my_history, opp_history):\n${FALLBACK}`)
    expect(one(moduleWith(null), ['AID', 'WITHHOLD']).code).toContain('return "AID"')
  })

  it("a path that reaches no move ends with the round's first move, and nothing is added when every path decides", () => {
    const ifOnly = one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_first_turn' } }, DO0: { block: play('D') } } }))
    // the empty "otherwise" is left out
    expect(ifOnly.code).toBe(`def punish(my_history, opp_history):\n    if len(my_history) == 0:\n        return "D"\n${FALLBACK}`)
    expect(one(moduleWith(play('D'))).code).toBe('def punish(my_history, opp_history):\n    return "D"\n')
    const both = one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_first_turn' } }, DO0: { block: play('C') }, ELSE: { block: play('D') } } }))
    expect(both.code).not.toContain('safe default')
  })

  it('nothing to warn about: a module with gaps has no problems, and ends in a legal move', () => {
    for (const body of [null, { type: 'ic_if', inputs: { IF0: { block: { type: 'ic_first_turn' } }, DO0: { block: play('D') } } }, play('C')]) {
      const module = one(moduleWith(body))
      expect(module.problems).toEqual([])
      expect(module.code).toMatch(/ {4}return "[CD]"\n$/)
      expect(Object.keys(module).sort()).toEqual(['code', 'name', 'problems'])
    }
  })

  it('reports an if with no condition and loose blocks', () => {
    expect(one(moduleWith({ type: 'controls_ifelse' })).problems).toEqual(['An if block has no condition. Attach one.'])
    expect(one(moduleWith({ type: 'ic_if' })).problems).toEqual(['An if block has no condition. Attach one.'])
    expect(one(moduleWith(null, 'punish', [play('C')])).problems[0]).toMatch('not attached')
  })

  it('never lets layout text reach the Python', () => {
    const evil = '"\nimport os\n#'
    const result = one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: evil } } }, DO0: { block: play(evil) } } }, `x${evil}`))
    expect(result.code).not.toContain('import os')
    expect(result.problems.length).toBeGreaterThan(0)
    const strat = strategy(strategyWith({ type: 'ic_if', inputs: { IF0: { block: { type: 'ic_opp_ever', fields: { MOVE: evil } } }, DO0: { block: play('D') } } }, evil))
    expect(strat.code).not.toContain('import os')
    expect(strat.problems.length).toBeGreaterThan(0)
  })

  it('rejects unknown blocks, and reserved, Python and repeated names', () => {
    expect(one(moduleWith({ type: 'ic_send_troops' })).problems[0]).toMatch("can't be used here")
    expect(one(moduleWith(null, 'strategy')).problems[0]).toMatch('reserved')
    expect(one(moduleWith(null, 'class')).problems[0]).toMatch('Python word')
    expect(generateModules([moduleWith(null), moduleWith(null)], PD)[0].problems[0]).toMatch('Two modules')
  })

  it('survives any JSON and very deep nesting', () => {
    for (const junk of [{}, { blocks: 5 }, { blocks: { blocks: 'x' } }, { blocks: { blocks: [null, 3, { type: 7 }] } }]) {
      expect(() => generateModules([junk], PD)).not.toThrow()
      expect(() => strategy(junk)).not.toThrow()
    }
    let deep: Record<string, unknown> = play('C')
    for (let i = 0; i < 20000; i++) deep = { type: 'controls_ifelse', inputs: { DO0: { block: deep } } }
    expect(one(moduleWith(deep)).problems).toContain('Blocks are nested too deeply.')
    let deepCondition: Record<string, unknown> = { type: 'ic_first_turn' }
    for (let i = 0; i < 20000; i++) deepCondition = { type: 'logic_negate', inputs: { BOOL: { block: deepCondition } } }
    expect(strategy(strategyWith({ type: 'ic_if', inputs: { IF0: { block: deepCondition }, DO0: { block: play('D') } } })).problems).toContain('Blocks are nested too deeply.')
  })

  it('every example works as a module too, and the limit hides what no longer fits', () => {
    for (const example of EXAMPLES.prisoners_dilemma) {
      const result = one(exampleLayout(example, 'plan'), gameInfo('prisoners_dilemma').moves)
      expect([example.name, result.problems]).toEqual([example.name, []])
    }
    expect(examplesFor('prisoners_dilemma', 40).length).toBe(EXAMPLES.prisoners_dilemma.length)
    expect(examplesFor('prisoners_dilemma', 2).map((e) => e.name)).toEqual(['Always Cooperate', 'Always Betray'])
    expect(examplesFor('prisoners_dilemma', 1)).toEqual([])
    expect(examplesFor('theatre_of_war', 40)).toEqual([])
    expect(examplesFor('surprise', 40)).toEqual([])
  })

  it('puts blocks after the code, so server line numbers still match strategy.py, and can split them again', () => {
    const hand = 'def strategy(m, o):\n    return plan(m, o)\n'
    expect(assemble(hand, [])).toBe(hand)
    expect(handCodeOf(hand)).toBe(hand)
    const modules = generateModules([moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: 10 } } }, DO0: { block: play('C') }, ELSE: { block: play('D') } } }, 'plan')], PD)
    const code = assemble(hand, modules)
    expect(code.startsWith(hand)).toBe(true)
    expect(code).toContain('import random')
    expect(code).toContain('def plan(my_history, opp_history):')
    expect(handCodeOf(code)).toBe(hand)
  })
})

describe('Round 1 strategy block (Build with blocks)', () => {
  // BLOCKS.md section 1.2, word for word
  const SPEC: Record<string, string> = {
    'Always Cooperate': 'def strategy(my_history, opp_history):\n    return "C"\n',
    'Always Betray': 'def strategy(my_history, opp_history):\n    return "D"\n',
    'Tit for Tat': 'def strategy(my_history, opp_history):\n    if len(opp_history) > 0 and opp_history[-1] == "D":\n        return "D"\n    # If nothing above decided\n    return "C"\n',
    Grudger: 'def strategy(my_history, opp_history):\n    if "D" in opp_history:\n        return "D"\n    # If nothing above decided\n    return "C"\n',
    'Forgiving Tit for Tat':
      'import random\n\n\ndef strategy(my_history, opp_history):\n    if len(opp_history) > 0 and opp_history[-1] == "D":\n        if random.random() < 0.1:\n            return "C"\n        else:\n            return "D"\n    # If nothing above decided\n    return "C"\n',
  }
  const BLOCKS: Record<string, number> = { 'Always Cooperate': 2, 'Always Betray': 2, 'Tit for Tat': 4, Grudger: 4, 'Forgiving Tit for Tat': 7 }

  it.each(EXAMPLES.prisoners_dilemma.map((e) => [e.name, e] as const))('%s generates the Python in BLOCKS.md, with no problems', (name, example) => {
    expect(strategy(strategyLayout(example))).toEqual({ code: SPEC[name], problems: [] })
    expect(exampleBlocks(example)).toBe(BLOCKS[name])
  })

  it('every example opens on the strategy block, which cannot be deleted', () => {
    for (const example of EXAMPLES.prisoners_dilemma) {
      const [top] = (strategyLayout(example).blocks as { blocks: Record<string, unknown>[] }).blocks
      expect([top.type, top.deletable]).toEqual(['ic_strategy', false])
    }
  })

  it('an empty strategy plays its fallback, and the fallback is the move picked on the block', () => {
    expect(strategy(newStrategy('prisoners_dilemma', PD))).toEqual({ code: 'def strategy(my_history, opp_history):\n    # If nothing above decided\n    return "C"\n', problems: [] })
    expect(strategy(strategyWith(null, 'D')).code).toContain('return "D"')
    expect(strategy(strategyWith(null, 'ATTACK')).problems[0]).toContain('cooperate, betray')
  })

  it('writes the new blocks as BLOCKS.md says', () => {
    const cond = (block: unknown) => strategy(strategyWith({ type: 'ic_if', inputs: { IF0: { block }, DO0: { block: play('D') } } })).code.split('\n')[1]
    expect(cond({ type: 'ic_my_last', fields: { MOVE: 'D' } })).toBe('    if len(my_history) > 0 and my_history[-1] == "D":')
    expect(cond({ type: 'ic_opp_ever', fields: { MOVE: 'C' } })).toBe('    if "C" in opp_history:')
    expect(cond({ type: 'ic_opp_rate', fields: { MOVE: 'D', OP: 'GT', PERCENT: 50 } })).toBe('    if opp_history.count("D") > 0.5 * len(opp_history):')
    expect(cond({ type: 'logic_operation', fields: { OP: 'OR' }, inputs: { A: { block: { type: 'ic_first_turn' } }, B: { block: { type: 'ic_opp_ever', fields: { MOVE: 'D' } } } } })).toBe(
      '    if (len(my_history) == 0 or "D" in opp_history):',
    )
    expect(cond({ type: 'logic_negate', inputs: { BOOL: { block: { type: 'ic_opp_last', fields: { MOVE: 'D' } } } } })).toBe('    if not (len(opp_history) > 0 and opp_history[-1] == "D"):')
  })

  it('reports empty slots and stray blocks in plain words', () => {
    expect(strategy(strategyWith({ type: 'logic_operation' })).problems).toEqual(["The 'logic_operation' block can't be used here."])
    expect(strategy(strategyWith({ type: 'ic_if', inputs: { IF0: { block: { type: 'logic_operation', fields: { OP: 'AND' } } } } })).problems).toEqual(['An "and" block needs a condition on both sides.'])
    expect(strategy(strategyWith({ type: 'ic_if', inputs: { IF0: { block: { type: 'logic_negate' } } } })).problems).toEqual(['A "not" block needs a condition inside.'])
    expect(strategy(strategyWith(null, 'C', [play('D')])).problems).toEqual(['Some blocks are outside your strategy block. Put them inside it or delete them.'])
    expect(strategy({ blocks: { blocks: [] } }).problems[0]).toMatch('strategy block is missing')
    expect(strategy(strategyWith({ type: 'ic_module' })).problems).toEqual(["The 'ic_module' block can't be used here."])
  })

  it('Round 2 has no strategy block', () => {
    expect(generateStrategy(newStrategy('prisoners_dilemma', PD), 'theatre_of_war', { moves: [] }).problems.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// No path ever falls off the end: checked on examples, on deliberately incomplete layouts, and on
// random layouts, first as text and then by running the Python in the engine's own sandbox.

/** A small seeded random generator, so a failing layout can be reproduced. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Random Round 1 layouts, often incomplete: missing conditions, empty branches, ifs with nothing inside. */
function randomBodies(count: number, seed: number): (BlockState | undefined)[] {
  const random = seeded(seed)
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]
  const maybe = <T,>(value: () => T, odds = 0.8) => (random() < odds ? value() : undefined)
  const move = () => pick(PD)
  const condition = (depth: number): BlockState => {
    const kind = pick(['ic_opp_last', 'ic_opp_ever', 'ic_opp_rate', 'ic_my_last', 'ic_first_turn', 'ic_chance', ...(depth < 3 ? ['logic_operation', 'logic_negate'] : [])])
    if (kind === 'logic_operation') return { type: kind, fields: { OP: pick(['AND', 'OR']) }, inputs: { A: { block: maybe(() => condition(depth + 1)) }, B: { block: maybe(() => condition(depth + 1)) } } }
    if (kind === 'logic_negate') return { type: kind, inputs: { BOOL: { block: maybe(() => condition(depth + 1)) } } }
    return { type: kind, fields: { MOVE: move(), OP: pick(['GT', 'LT']), PERCENT: Math.floor(random() * 101) } }
  }
  const chain = (depth: number): BlockState | undefined => {
    const length = Math.floor(random() * 3)
    let first: BlockState | undefined
    for (let i = 0; i < length; i++) {
      const kind = depth < 3 ? pick(['ic_play', 'ic_if', 'controls_ifelse']) : 'ic_play'
      const block: BlockState =
        kind === 'ic_play'
          ? { type: kind, fields: { MOVE: move() } }
          : { type: kind, inputs: { IF0: { block: maybe(() => condition(0)) }, DO0: { block: maybe(() => chain(depth + 1), 0.7) }, ...(kind === 'controls_ifelse' ? { ELSE: { block: maybe(() => chain(depth + 1), 0.5) } } : {}) } }
      // a play block has no "next", so it ends the chain
      first = first ? appendTo(first, block) : block
      if (kind === 'ic_play') break
    }
    return first
  }
  return Array.from({ length: count }, () => chain(0))
}

function appendTo(first: BlockState, block: BlockState): BlockState {
  let last = first
  while (last.next?.block) last = last.next.block
  last.next = { block }
  return first
}

/** Deliberately incomplete layouts: every shape that used to fall off the end. */
const INCOMPLETE: (BlockState | undefined)[] = [
  undefined,
  { type: 'ic_if' },
  { type: 'ic_if', inputs: { IF0: { block: { type: 'ic_first_turn' } } } },
  { type: 'ic_if', inputs: { IF0: { block: { type: 'ic_first_turn' } }, DO0: { block: play('D') } } },
  { type: 'controls_ifelse' },
  { type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: 50 } } }, DO0: { block: play('D') } } },
  { type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: 50 } } }, ELSE: { block: play('D') } } },
  { type: 'controls_ifelse', inputs: { IF0: { block: { type: 'logic_operation', fields: { OP: 'AND' } } }, DO0: { block: { type: 'ic_if' } }, ELSE: { block: { type: 'ic_if' } } } },
  { type: 'ic_send_troops' },
]

/** Every way a Round 1 layout becomes Python: as the strategy block, and as a Write-code module behind a strategy that calls it. */
function programs(bodies: (BlockState | undefined)[]): { label: string; code: string }[] {
  const hand = 'def strategy(my_history, opp_history):\n    return plan(my_history, opp_history)\n'
  return bodies.flatMap((body, i) => [
    { label: `strategy #${i}`, code: strategy(strategyWith(body, i % 2 ? 'D' : 'C')).code },
    { label: `module #${i}`, code: assemble(hand, generateModules([moduleWith(body, 'plan')], PD)) },
  ])
}

const EXAMPLE_PROGRAMS = EXAMPLES.prisoners_dilemma.flatMap((example) => [
  { label: `${example.name} (strategy)`, code: strategy(strategyLayout(example)).code },
  { label: `${example.name} (module)`, code: assemble('def strategy(my_history, opp_history):\n    return plan(my_history, opp_history)\n', generateModules([exampleLayout(example, 'plan')], PD)) },
])
const ALL_PROGRAMS = [...EXAMPLE_PROGRAMS, ...programs(INCOMPLETE), ...programs(randomBodies(300, 20261110))]

describe('no generated code ever returns None', () => {
  it.each(ALL_PROGRAMS.map((p) => [p.label, p.code] as const))('%s', (_, code) => {
    expect(code).not.toContain('return None')
    expect(code).toContain('def strategy(my_history, opp_history):')
  })

  it('the junk-layout generators never fall back to None either', () => {
    for (const junk of [{}, { blocks: 5 }, { blocks: { blocks: [null, 3, { type: 7 }] } }]) {
      expect(strategy(junk).code).not.toContain('None')
      expect(generateModules([junk], PD)[0].code).not.toContain('None')
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The generated Python, run by python3 through the engine's own loader (engine/sandbox.py
// load_bot: the same checks, builtins and imports the server allows). engine/ is only read.

type Node = {
  spawnSync: (cmd: string, args: string[], options: { input?: string; encoding: 'utf8'; maxBuffer?: number }) => { status: number | null; stdout: string; stderr: string; error?: Error }
}
type NodeUrl = { fileURLToPath: (url: URL) => string }

const REPO_ROOT_URL = new URL('../../../../', import.meta.url)

/**
 * Runs a Python script with python3 and gives back its JSON output. Fails with a clear message when python3 is missing.
 * -I ignores the environment and the current folder; each script adds only the repo root, to import engine/.
 */
async function python3(): Promise<(args: string[], input: unknown) => unknown> {
  // Node built-ins, loaded by name so the browser build's types (src has no Node types) stay as they are
  const childProcess = 'node:child_process'
  const url = 'node:url'
  const { spawnSync } = (await import(/* @vite-ignore */ childProcess)) as Node
  const { fileURLToPath } = (await import(/* @vite-ignore */ url)) as NodeUrl
  const version = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  if (version.error || version.status !== 0) {
    throw new Error('python3 is needed to run the generated strategies in these tests. Install Python 3 and make sure `python3` is on your PATH, then run vitest again.')
  }
  const root = fileURLToPath(REPO_ROOT_URL)
  const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
  return (args, input) => {
    const resolved = args.map((a) => (a.endsWith('.py') ? path(a) : a))
    const result = spawnSync('python3', ['-I', ...resolved, root], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`python3 failed:\n${result.stderr}`)
    return JSON.parse(result.stdout)
  }
}

/** Loads each bot like the server does, plays it against every history, and lists what it returned. */
const RUNNER = `
import json, sys
sys.path.insert(0, sys.argv[1])
from engine.sandbox import load_bot
job = json.load(sys.stdin)
out = []
for i, code in enumerate(job["codes"]):
    try:
        bot = load_bot(code, random_seed=i)
        seen = set()
        for _ in range(job["repeats"]):
            for my, opp in job["histories"]:
                move = bot(list(my), list(opp))
                seen.add(move if type(move) is str else repr(move))
        out.append({"moves": sorted(seen)})
    except Exception as error:
        out.append({"error": f"{type(error).__name__}: {error}"})
print(json.dumps(out))
`

let run: (codes: string[], histories: [string[], string[]][], repeats?: number) => { moves?: string[]; error?: string }[]

function historiesPD(): [string[], string[]][] {
  const random = seeded(7)
  const long = (n: number) => Array.from({ length: n }, () => (random() < 0.5 ? 'C' : 'D'))
  return [
    [[], []],
    [['C'], ['C']],
    [['C'], ['D']],
    [['D'], ['C']],
    [['D'], ['D']],
    [['C', 'C', 'D'], ['D', 'C', 'C']],
    [long(50), long(50)],
    [long(199), Array(199).fill('D')],
  ]
}

describe('the generated Round 1 Python plays only "C" or "D" (python3, engine sandbox)', () => {
  beforeAll(async () => {
    const python = await python3()
    run = (codes, histories, repeats = 20) => python(['-c', RUNNER], { codes, histories, repeats }) as ReturnType<typeof run>
  })

  it('each example, as the strategy block and as a module', () => {
    const results = run(
      EXAMPLE_PROGRAMS.map((p) => p.code),
      historiesPD(),
    )
    EXAMPLE_PROGRAMS.forEach((p, i) => {
      expect([p.label, results[i].error]).toEqual([p.label, undefined])
      expect([p.label, results[i].moves!.every((m) => m === 'C' || m === 'D')]).toEqual([p.label, true])
    })
  })

  it('plays as the examples should', () => {
    const byName = (name: string) => EXAMPLES.prisoners_dilemma.find((e) => e.name === name)!
    const play1 = (name: string, histories: [string[], string[]][], repeats = 20) => run([strategy(strategyLayout(byName(name))).code], histories, repeats)[0].moves
    expect(play1('Always Cooperate', historiesPD())).toEqual(['C'])
    expect(play1('Always Betray', historiesPD())).toEqual(['D'])
    expect(play1('Tit for Tat', [[[], []], [['C'], ['C']]])).toEqual(['C'])
    expect(play1('Tit for Tat', [[['C'], ['D']]])).toEqual(['D'])
    expect(play1('Grudger', [[['C', 'C', 'C'], ['D', 'C', 'C']]])).toEqual(['D'])
    expect(play1('Grudger', [[['C', 'C'], ['C', 'C']]])).toEqual(['C'])
    // forgives about 1 betrayal in 10, so over 200 tries both moves show up
    expect(play1('Forgiving Tit for Tat', [[['C'], ['D']]], 200)).toEqual(['C', 'D'])
  })

  it('every incomplete and random layout still returns a legal move on every path', () => {
    const all = [...programs(INCOMPLETE), ...programs(randomBodies(300, 20261110))]
    const results = run(
      all.map((p) => p.code),
      historiesPD(),
    )
    const bad = all.map((p, i) => ({ label: p.label, ...results[i] })).filter((r) => r.error || !r.moves!.every((m) => m === 'C' || m === 'D'))
    expect(bad).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Round 3: Foreign Aid

const AID = { moves: [], endowment: 10, multiplier: 3 }
const aid = (layout: Record<string, unknown>, config: Record<string, unknown> = AID) => generateStrategy(layout, 'foreign_aid', config as typeof AID)
const aidWith = (sending?: unknown, receiving?: unknown, SEND_DEFAULT: unknown = 5, RETURN_PCT_DEFAULT: unknown = 50, extra: unknown[] = []) => ({
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'fa_strategy',
        fields: { SEND_DEFAULT, RETURN_PCT_DEFAULT },
        inputs: { ...(sending ? { SEND: { block: sending } } : {}), ...(receiving ? { RECEIVE: { block: receiving } } : {}) },
      },
      ...extra,
    ],
  },
})
const n = (NUM: unknown) => ({ type: 'fa_number', fields: { NUM } })
const faSend = (amount?: unknown) => ({ type: 'fa_send', inputs: amount ? { AMOUNT: { block: amount } } : {} })
const faReturn = (amount?: unknown) => ({ type: 'fa_return', inputs: amount ? { AMOUNT: { block: amount } } : {} })
/** The strategy function only, from "def strategy" on. */
const strategyFn = (code: string) => code.slice(code.indexOf('def strategy('))

describe('Round 3 strategy block (Build with blocks)', () => {
  // BLOCKS.md section 1.3, word for word
  const SPLIT = '    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)\n    if len(opp_history) == len(my_history):\n        # When I\'m sending\n'
  const RECEIVING = "    # When I'm receiving: the opponent just sent opp_history[-1]\n    received = MULTIPLIER * opp_history[-1]\n"
  const HALF_BACK = '    # If nothing above decided\n    return legal_return(received * 50 // 100, received)\n'
  const SPEC: Record<string, string> = {
    'Break Even': `def strategy(my_history, opp_history):\n${SPLIT}        # If nothing above decided\n        return legal_send(5)\n${RECEIVING}    return legal_return((opp_sent[-1] if opp_sent else 0), received)\n`,
    Mirror: `def strategy(my_history, opp_history):\n${SPLIT}        if ((opp_returned[-1] if opp_returned else 0) >= (my_sent[-1] if my_sent else 0)):\n            return legal_send(10)\n        # If nothing above decided\n        return legal_send(2)\n${RECEIVING}${HALF_BACK}`,
    Grudger: `def strategy(my_history, opp_history):\n${SPLIT}        if ever_short_changed(my_sent, opp_returned):\n            return legal_send(0)\n        # If nothing above decided\n        return legal_send(10)\n${RECEIVING}${HALF_BACK}`,
    Matcher: `def strategy(my_history, opp_history):\n${SPLIT}        if len(my_sent) == 0:\n            return legal_send(10)\n        return legal_send(average(opp_sent))\n${RECEIVING}${HALF_BACK}`,
  }
  const BLOCKS: Record<string, number> = { 'Break Even': 3, Mirror: 7, Grudger: 5, Matcher: 7 }
  const HELPERS: Record<string, string[]> = { 'Break Even': [], Mirror: [], Grudger: ['ever_short_changed'], Matcher: ['average'] }

  it.each(EXAMPLES.foreign_aid.map((e) => [e.name, e] as const))('%s generates the Python in BLOCKS.md, with only the helpers it uses', (name, example) => {
    const { code, problems } = aid(strategyLayout(example))
    expect(problems).toEqual([])
    expect(strategyFn(code)).toBe(SPEC[name])
    expect(exampleBlocks(example)).toBe(BLOCKS[name])
    for (const always of ['def legal_send(', 'def legal_return(', 'def split_history(', 'ENDOWMENT = 10', 'MULTIPLIER = 3']) expect(code).toContain(always)
    const used = ['average', 'return_rate', 'ever_short_changed', 'divide'].filter((h) => code.includes(`def ${h}(`))
    expect(used).toEqual(HELPERS[name])
    expect(code).not.toContain('import random')
  })

  it('every example opens on the strategy block, which cannot be deleted, and the limit hides what no longer fits', () => {
    for (const example of EXAMPLES.foreign_aid) {
      const [top] = (strategyLayout(example).blocks as { blocks: Record<string, unknown>[] }).blocks
      expect([top.type, top.deletable]).toEqual(['fa_strategy', false])
    }
    expect(examplesFor('foreign_aid', 40).map((e) => e.name)).toEqual(['Break Even', 'Mirror', 'Grudger', 'Matcher'])
    expect(examplesFor('foreign_aid', 5).map((e) => e.name)).toEqual(['Break Even', 'Grudger'])
  })

  it('writes endowment and multiplier from the round config, and falls back to 10 and 3 only before the round arrives', () => {
    const empty = newStrategy('foreign_aid', [])
    expect(aid(empty, { moves: [], endowment: 20, multiplier: 4 }).code).toMatch(/^ENDOWMENT = 20 .*\nMULTIPLIER = 4 /m)
    expect(aid(empty, { moves: [] }).code).toMatch(/^ENDOWMENT = 10 .*\nMULTIPLIER = 3 /m)
    // Nothing but a positive whole number reaches the Python
    for (const junk of [-1, 0, 2.5, '7\nimport os', null, 1e9]) expect(aid(empty, { moves: [], endowment: junk, multiplier: junk }).code).toMatch(/^ENDOWMENT = 10 .*\nMULTIPLIER = 3 /m)
    // The send fallback is kept within the endowment
    expect(aid(aidWith(undefined, undefined, 50), { moves: [], endowment: 20, multiplier: 3 }).code).toContain('return legal_send(20)')
  })

  it('an empty strategy sends 5 and sends back half', () => {
    const { code, problems } = aid(newStrategy('foreign_aid', []))
    expect(problems).toEqual([])
    expect(code).toContain('        # If nothing above decided\n        return legal_send(5)\n')
    expect(code).toContain(HALF_BACK)
  })

  it('writes every value, condition and maths block as BLOCKS.md says', () => {
    const sendOf = (amount: unknown) => aid(aidWith(faSend(amount))).code.match(/return legal_send\((.*)\)\n/)![1]
    const backOf = (amount: unknown) => aid(aidWith(undefined, faReturn(amount))).code.match(/return legal_return\((.*), received\)\n/)![1]
    expect(sendOf({ type: 'fa_turn' })).toBe('(len(my_history) + 1)')
    expect(sendOf({ type: 'fa_my_last', fields: { WHAT: 'RETURN' } })).toBe('(my_returned[-1] if my_returned else 0)')
    expect(sendOf({ type: 'fa_opp_avg', fields: { WHAT: 'RETURN_PCT' } })).toBe('return_rate(opp_returned, my_sent)')
    expect(sendOf({ type: 'fa_arith', fields: { OP: 'SUB' }, inputs: { A: { block: n(7) }, B: { block: n(2) } } })).toBe('(7 - 2)')
    expect(sendOf({ type: 'fa_arith', fields: { OP: 'MUL' }, inputs: { A: { block: n(7) }, B: { block: n(2) } } })).toBe('(7 * 2)')
    expect(sendOf({ type: 'fa_percent_of', fields: { PERCENT: 50 }, inputs: { X: { block: n(12) } } })).toBe('(50 / 100 * 12)')
    expect(sendOf({ type: 'fa_random', fields: { FROM: 8, TO: 3 } })).toBe('random.randint(3, 8)')
    expect(backOf({ type: 'fa_received' })).toBe('received')
    expect(aid(aidWith(undefined, { type: 'fa_return_pct', fields: { PERCENT: 34 } })).code).toContain('return legal_return(received * 34 // 100, received)')

    const ifSend = (condition: unknown, section: 'send' | 'receive' = 'send') => {
      const block = { type: 'ic_if', inputs: { IF0: { block: condition }, DO0: { block: section === 'send' ? faSend(n(1)) : faReturn(n(1)) } } }
      // the strategy's own role check is the first if; the block's is the second
      return [...aid(section === 'send' ? aidWith(block) : aidWith(undefined, block)).code.matchAll(/^ +if (.*):$/gm)][1][1]
    }
    const two = (OP: string) => ({ type: 'fa_compare', fields: { OP }, inputs: { A: { block: n(1) }, B: { block: n(2) } } })
    expect(['GT', 'LT', 'GTE', 'LTE', 'EQ'].map((op) => ifSend(two(op)))).toEqual(['(1 > 2)', '(1 < 2)', '(1 >= 2)', '(1 <= 2)', '(1 == 2)'])
    expect(ifSend({ type: 'fa_first_time' })).toBe('len(my_sent) == 0')
    expect(ifSend({ type: 'fa_first_time' }, 'receive')).toBe('len(my_returned) == 0')
    expect(ifSend({ type: 'ic_chance', fields: { PERCENT: 25 } })).toBe('random.random() < 0.25')
    expect(ifSend({ type: 'logic_negate', inputs: { BOOL: { block: { type: 'fa_opp_ever_short' } } } })).toBe('not (ever_short_changed(my_sent, opp_returned))')
  })

  it('divides through a helper, so dividing by 0, or by a random number, can never fail', () => {
    const { code } = aid(aidWith(faSend({ type: 'fa_arith', fields: { OP: 'DIV' }, inputs: { A: { block: n(10) }, B: { block: { type: 'fa_random', fields: { FROM: 0, TO: 1 } } } } })))
    expect(code).toContain('return legal_send(divide(10, random.randint(0, 1)))')
    expect(code).toContain('def divide(a, b):')
    expect(code.startsWith('import random\n')).toBe(true)
  })

  it('reports actions and values in the wrong section, and empty slots, in plain words', () => {
    expect(aid(aidWith(undefined, faSend(n(5)))).problems).toEqual(["Use 'send back' under 'when I'm receiving'."])
    expect(aid(aidWith(faReturn(n(5)))).problems).toEqual(["Use 'send' under 'when I'm sending'."])
    expect(aid(aidWith({ type: 'fa_return_pct', fields: { PERCENT: 50 } })).problems).toEqual(["Use 'send' under 'when I'm sending'."])
    expect(aid(aidWith(faSend({ type: 'fa_received' }))).problems).toEqual(["This only has a value when you're receiving."])
    expect(aid(aidWith(faSend())).problems).toEqual(['The send block needs a number. Drag one in from Numbers.'])
    expect(aid(aidWith(undefined, faReturn())).problems).toEqual(['The send back block needs a number. Drag one in from Numbers.'])
    expect(aid(aidWith(faSend({ type: 'fa_arith', fields: { OP: 'ADD' } }))).problems).toEqual(['A maths block needs a number on both sides. Drag one in from Numbers.'])
    expect(aid(aidWith(faSend({ type: 'fa_percent_of', fields: { PERCENT: 5 } }))).problems).toEqual(["The '% of' block needs a number. Drag one in from Numbers."])
    expect(aid(aidWith({ type: 'ic_if', inputs: { IF0: { block: { type: 'fa_compare', fields: { OP: 'GT' } } } } })).problems).toEqual([
      'A comparison needs a number on both sides. Drag one in from Numbers.',
    ])
    expect(aid(aidWith({ type: 'ic_if' })).problems).toEqual(['An if block has no condition. Attach one.'])
    expect(aid(aidWith(undefined, undefined, 5, 50, [n(3)])).problems).toEqual(['Some blocks are outside your strategy block. Put them inside it or delete them.'])
    expect(aid(aidWith({ type: 'ic_play', fields: { MOVE: 'C' } })).problems).toEqual(["The 'ic_play' block can't be used here."])
    expect(aid(newStrategy('prisoners_dilemma', PD)).problems[0]).toMatch('strategy block is missing')
    // a mistake under a send that always decides still gets reported
    expect(aid(aidWith({ ...faSend(n(1)), next: { block: faReturn(n(1)) } })).problems).toEqual(["Use 'send' under 'when I'm sending'."])
  })

  it('never lets layout text reach the Python, and survives any JSON and very deep nesting', () => {
    const evil = '1)\nimport os\n#'
    const result = aid(aidWith(faSend(n(evil)), { type: 'fa_return_pct', fields: { PERCENT: evil } }, evil, evil))
    expect(result.code).not.toContain('import os')
    for (const junk of [{}, { blocks: 5 }, { blocks: { blocks: 'x' } }, { blocks: { blocks: [null, 3, { type: 7 }] } }]) expect(aid(junk).code).not.toContain('None')
    let deep: Record<string, unknown> = n(1)
    for (let i = 0; i < 20000; i++) deep = { type: 'fa_arith', fields: { OP: 'ADD' }, inputs: { A: { block: deep }, B: { block: n(1) } } }
    expect(aid(aidWith(faSend(deep))).problems).toContain('Blocks are nested too deeply.')
  })
})

/** Random Round 3 layouts, often incomplete or wrong: empty slots, actions in the wrong section, values that only work when receiving. */
function randomAid(count: number, seed: number): Record<string, unknown>[] {
  const random = seeded(seed)
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]
  const maybe = <T,>(value: () => T, odds = 0.85) => (random() < odds ? value() : undefined)
  const value = (depth: number): BlockState => {
    const kind = pick(['fa_number', 'fa_number', 'fa_opp_sent_last', 'fa_opp_returned_last', 'fa_opp_avg', 'fa_received', 'fa_my_last', 'fa_turn', 'fa_random', ...(depth < 3 ? ['fa_arith', 'fa_arith', 'fa_percent_of'] : [])])
    const fields = { NUM: Math.floor(random() * 101), WHAT: pick(['SEND', 'RETURN_PCT', 'RETURN']), FROM: Math.floor(random() * 101), TO: Math.floor(random() * 101), OP: pick(['ADD', 'SUB', 'MUL', 'DIV']), PERCENT: Math.floor(random() * 101) }
    if (kind === 'fa_arith') return { type: kind, fields, inputs: { A: { block: maybe(() => value(depth + 1)) }, B: { block: maybe(() => value(depth + 1)) } } }
    if (kind === 'fa_percent_of') return { type: kind, fields, inputs: { X: { block: maybe(() => value(depth + 1)) } } }
    return { type: kind, fields }
  }
  const condition = (depth: number): BlockState => {
    const kind = pick(['fa_compare', 'fa_compare', 'fa_opp_ever_short', 'fa_first_time', 'ic_chance', ...(depth < 2 ? ['logic_operation', 'logic_negate'] : [])])
    if (kind === 'fa_compare') return { type: kind, fields: { OP: pick(['GT', 'LT', 'GTE', 'LTE', 'EQ']) }, inputs: { A: { block: maybe(() => value(0)) }, B: { block: maybe(() => value(0)) } } }
    if (kind === 'logic_operation') return { type: kind, fields: { OP: pick(['AND', 'OR']) }, inputs: { A: { block: maybe(() => condition(depth + 1)) }, B: { block: maybe(() => condition(depth + 1)) } } }
    if (kind === 'logic_negate') return { type: kind, inputs: { BOOL: { block: maybe(() => condition(depth + 1)) } } }
    return { type: kind, fields: { PERCENT: Math.floor(random() * 101) } }
  }
  const chain = (depth: number): BlockState | undefined => {
    const length = Math.floor(random() * 3)
    let first: BlockState | undefined
    for (let i = 0; i < length; i++) {
      const kind = depth < 2 ? pick(['fa_send', 'fa_return', 'fa_return_pct', 'ic_if', 'controls_ifelse']) : pick(['fa_send', 'fa_return', 'fa_return_pct'])
      const block: BlockState =
        kind === 'fa_return_pct'
          ? { type: kind, fields: { PERCENT: Math.floor(random() * 101) } }
          : kind === 'fa_send' || kind === 'fa_return'
            ? { type: kind, inputs: { AMOUNT: { block: maybe(() => value(0)) } } }
            : { type: kind, inputs: { IF0: { block: maybe(() => condition(0)) }, DO0: { block: maybe(() => chain(depth + 1), 0.7) }, ...(kind === 'controls_ifelse' ? { ELSE: { block: maybe(() => chain(depth + 1), 0.5) } } : {}) } }
      first = first ? appendTo(first, block) : block
      if (kind !== 'ic_if' && kind !== 'controls_ifelse') break
    }
    return first
  }
  return Array.from({ length: count }, () => aidWith(chain(0), chain(0), Math.floor(random() * 15) - 2, Math.floor(random() * 120) - 10))
}

type Played = { calls?: number; problems?: string[]; error?: string }

describe('the generated Round 3 Python plays only legal amounts (python3, engine foreign_aid validator and sample bots)', () => {
  let play: (codes: string[], turns: number, seeds: number[]) => Played[]
  beforeAll(async () => {
    const python = await python3()
    play = (bots, turns, seeds) => python(['play_foreign_aid.py'], { bots, turns, seeds }) as Played[]
  })

  // A copy of itself is also an opponent, so each example plays 5 opponents x 2 seats x 2 seeds = 20 matches
  it.each(EXAMPLES.foreign_aid.map((e) => [e.name, e] as const))('%s: 200 turns in both seats against every sample bot, zero invalid moves', (_, example) => {
    const [result] = play([aid(strategyLayout(example)).code], 200, [1, 2])
    expect(result).toEqual({ calls: expect.any(Number), problems: [] })
    // every match is 200 turns, and the bot moves once a turn (send or send back): 20 matches x 200 turns
    expect(result.calls).toBe(20 * 200)
  }, 120_000)

  it('every incomplete and random layout, problems and all, still plays only legal whole amounts (60 turns)', () => {
    const layouts = [
      newStrategy('foreign_aid', []),
      aidWith(faSend()),
      aidWith(undefined, faReturn()),
      aidWith(undefined, faSend(n(10))),
      aidWith(faReturn(n(30))),
      aidWith(faSend({ type: 'fa_received' })),
      aidWith(faSend(n(100)), faReturn(n(100))),
      aidWith(faSend({ type: 'fa_arith', fields: { OP: 'SUB' }, inputs: { A: { block: n(0) }, B: { block: n(100) } } })),
      aidWith(faSend({ type: 'fa_arith', fields: { OP: 'DIV' }, inputs: { A: { block: n(7) }, B: { block: n(0) } } })),
      aidWith({ type: 'ic_if' }, { type: 'controls_ifelse' }),
      ...randomAid(150, 20261110),
    ]
    const codes = layouts.map((layout) => aid(layout).code)
    for (const code of codes) expect(code).not.toContain('return None')
    // 60 turns: every role, first time and running average comes up; the examples above play the full 200
    const results = play(codes, 60, [3])
    const bad = results.map((r, i) => ({ layout: i, ...r })).filter((r) => r.error || r.problems!.length > 0)
    expect(bad).toEqual([])
  }, 300_000)
})

describe('spotting a strategy that is exactly an example', () => {
  const CONFIGS: Record<string, { moves: string[]; endowment?: number; multiplier?: number }> = { prisoners_dilemma: { moves: PD }, foreign_aid: AID }

  it.each(Object.entries(EXAMPLES).flatMap(([game, examples]) => examples.map((e) => [game, e.name, e] as const)))('%s: %s, unchanged, is recognised by name', (game, name, example) => {
    const { code } = generateStrategy(strategyLayout(example), game, CONFIGS[game])
    expect(matchingExample(code, game, CONFIGS[game])?.name).toBe(name)
    // the same Python typed by hand also matches: line endings and trailing spaces don't count
    expect(matchingExample(code.replace(/\n/g, '  \r\n'), game, CONFIGS[game])?.name).toBe(name)
  })

  it('any real change is not a match', () => {
    const tft = EXAMPLES.prisoners_dilemma.find((e) => e.name === 'Tit for Tat')!
    const changed = strategy(strategyWith(tft.strategy.inputs!.BODY!.block, 'D'))
    expect(matchingExample(changed.code, 'prisoners_dilemma', { moves: PD })).toBeUndefined()
    const code = strategy(strategyLayout(tft)).code
    expect(matchingExample(code.replace('return "D"', 'return "C"'), 'prisoners_dilemma', { moves: PD })).toBeUndefined()
    expect(matchingExample(`${code}# mine\n`, 'prisoners_dilemma', { moves: PD })).toBeUndefined()
    // an example from another game, or no examples at all, never matches
    expect(matchingExample(code, 'foreign_aid', AID)).toBeUndefined()
    expect(matchingExample(code, 'theatre_of_war', { moves: [] })).toBeUndefined()
  })

  it('in Round 3 the match uses the round config, since the limits are written into the file', () => {
    const breakEven = EXAMPLES.foreign_aid[0]
    const at20 = generateStrategy(strategyLayout(breakEven), 'foreign_aid', { moves: [], endowment: 20, multiplier: 3 }).code
    expect(matchingExample(at20, 'foreign_aid', { moves: [], endowment: 20, multiplier: 3 })?.name).toBe('Break Even')
    expect(matchingExample(at20, 'foreign_aid', AID)).toBeUndefined()
  })

  it('every example says what it is weak at, in one line', () => {
    for (const example of Object.values(EXAMPLES).flat()) {
      expect(example.weakness).toMatch(/^Weakness: [^\n]+\.$/)
      expect(example.weakness.length).toBeLessThan(100)
    }
  })
})
