import { describe, expect, it } from 'vitest'
import { EXAMPLES, exampleLayout, examplesFor } from '../workspace/blocks/examples'
import { generateModules } from '../workspace/blocks/generate'
import { countBlocks, moduleName } from '../workspace/blocks/layout'
import { newestDraft, parseAgent } from '../workspace/workspace/drafts'
import { parseSession } from './auth'
import { formatDuration, offsetFrom, windowRemaining } from './clock'
import { newId } from './ids'

describe('clock sync', () => {
  it('uses the midpoint of the round trip', () => {
    // sent at 1000, server says 5050, received at 1100: midpoint 1050, so 4000 ms ahead
    expect(offsetFrom(1000, 5050, 1100)).toBe(4000)
  })

  it('counts down from server time and freezes while paused', () => {
    const open = { status: 'open', closes_at: 100, paused_remaining: null }
    expect(windowRemaining(open, 40_000)).toEqual({ seconds: 60, paused: false })
    expect(windowRemaining(open, 200_000)).toEqual({ seconds: 0, paused: false })
    expect(windowRemaining({ ...open, paused_remaining: 42 }, 999_999)).toEqual({ seconds: 42, paused: true })
    expect(windowRemaining({ ...open, status: 'locked' }, 0)).toBeNull()
  })

  it('formats durations', () => {
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(-5)).toBe('00:00')
  })
})

describe('ids', () => {
  it('makes distinct v4 UUIDs', () => {
    const a = newId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(newId())
  })
})

describe('stored session', () => {
  it.each(['not json', 'null', '{}', '[]', '{"access":"a","refresh":"b","user":{}}', '{"access":1,"refresh":2,"user":null}'])(
    'rejects %s',
    (raw) => expect(parseSession(raw)).toBeNull(),
  )

  it('accepts a real one', () => {
    const user = { id: '1', username: 'team1', role: 'team', team: null }
    expect(parseSession(JSON.stringify({ access: 'a', refresh: 'b', user }))?.user.username).toBe('team1')
  })
})

describe('drafts', () => {
  it.each([null, 5, {}, { hand_code: 1, modules: [] }, { hand_code: 'x', modules: 'y' }, { hand_code: 'x', modules: [null] }])(
    'rejects %j',
    (value) => expect(parseAgent(value)).toBeNull(),
  )

  it('accepts an agent and old plain-code drafts', () => {
    expect(parseAgent({ hand_code: 'x', modules: [{ blocks: {} }] })?.modules).toHaveLength(1)
    expect(parseAgent({ agent: { hand_code: 'x', modules: [] }, saved_at: 5 })?.hand_code).toBe('x')
    expect(parseAgent('plain code')?.hand_code).toBe('plain code')
  })

  it('takes the newer of the two stored copies and survives a bad one', () => {
    const a = { agent: { hand_code: 'old', modules: [] }, saved_at: 1 }
    const b = { agent: { hand_code: 'new', modules: [] }, saved_at: 2 }
    expect(newestDraft(a, b)?.hand_code).toBe('new')
    expect(newestDraft(b, a)?.hand_code).toBe('new')
    expect(newestDraft({ nope: true }, b)?.hand_code).toBe('new')
    expect(newestDraft(undefined, undefined)).toBeUndefined()
  })
})

describe('layouts', () => {
  const layout = {
    blocks: {
      blocks: [
        {
          type: 'ic_module',
          fields: { NAME: 'punish' },
          inputs: { BODY: { block: { type: 'ic_return', inputs: { VALUE: { block: { type: 'ic_move' } } }, next: { block: { type: 'x' } } } } },
        },
      ],
    },
  }

  it('counts the same way as the server', () => {
    expect(countBlocks(layout)).toBe(4)
    expect(moduleName(layout)).toBe('punish')
  })

  it.each([{}, { blocks: null }, { blocks: { blocks: 'no' } }, { blocks: { blocks: [null, 5] } }, { blocks: { blocks: [{ inputs: { A: null } }] } }])(
    'does not throw on %j',
    (bad) => {
      expect(() => countBlocks(bad)).not.toThrow()
      expect(moduleName(bad)).toBe('module')
    },
  )
})

describe('generating Python from blocks', () => {
  const moduleWith = (body: unknown, name = 'punish', extra: unknown[] = []) => ({
    blocks: { languageVersion: 0, blocks: [{ type: 'ic_module', fields: { NAME: name }, inputs: body ? { BODY: { block: body } } : {} }, ...extra] },
  })
  const one = (layout: Record<string, unknown>) => generateModules([layout])[0]

  it('writes an if/else using the helpers', () => {
    const result = one(
      moduleWith({
        type: 'controls_ifelse',
        inputs: {
          IF0: { block: { type: 'ic_opp_rate', fields: { OP: 'GT', PERCENT: 60 } } },
          DO0: { block: { type: 'ic_play', fields: { MOVE: 'D' } } },
          ELSE: { block: { type: 'ic_play', fields: { MOVE: 'C' } } },
        },
      }),
    )
    expect(result.problems).toEqual([])
    expect(result.code).toBe('def punish(my_history, opp_history):\n    if opp_defection_rate() > 0.6:\n        return "D"\n    else:\n        return "C"\n')
  })

  it('an empty module is still valid Python', () => {
    expect(one(moduleWith(null)).code).toBe('def punish(my_history, opp_history):\n    return None\n')
  })

  it('reports an if with no condition and loose blocks', () => {
    expect(one(moduleWith({ type: 'controls_ifelse' })).problems).toEqual(['An if block has no condition. Attach one.'])
    expect(one(moduleWith(null, 'punish', [{ type: 'ic_play' }])).problems[0]).toMatch('not attached')
  })

  it('never lets layout text reach the Python', () => {
    const evil = '"\nimport os\n#'
    const result = one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: evil } } }, DO0: { block: { type: 'ic_play', fields: { MOVE: evil } } } } }, `x${evil}`))
    expect(result.code).not.toContain('import os')
    expect(result.problems.length).toBeGreaterThan(0)
  })

  it('rejects reserved, Python and repeated names', () => {
    expect(one(moduleWith(null, 'strategy')).problems[0]).toMatch('reserved')
    expect(one(moduleWith(null, 'class')).problems[0]).toMatch('Python word')
    expect(generateModules([moduleWith(null), moduleWith(null)])[0].problems[0]).toMatch('Two modules')
  })

  it('survives any JSON and very deep nesting', () => {
    for (const junk of [{}, { blocks: 5 }, { blocks: { blocks: 'x' } }, { blocks: { blocks: [null, 3, { type: 7 }] } }]) expect(() => generateModules([junk])).not.toThrow()
    let deep: Record<string, unknown> = { type: 'ic_play' }
    for (let i = 0; i < 20000; i++) deep = { type: 'controls_ifelse', inputs: { DO0: { block: deep } } }
    expect(one(moduleWith(deep)).problems).toContain('Blocks are nested too deeply.')
  })

  it('keeps bad numbers out of the round 2 and 3 Python', () => {
    const evil = '1]; import os #'
    const troops = generateModules([moduleWith({ type: 'ic_send_troops', fields: { R1: evil, R2: 500, R3: -9 } })], 'theatre_of_war')[0]
    expect(troops.code).not.toContain('import os')
    expect(troops.code).toContain('return [0, 100, 0, 0, 0]')
    expect(troops.problems).toEqual([])
    const share = generateModules([moduleWith({ type: 'ic_send_percent', fields: { PERCENT: evil } })], 'foreign_aid')[0]
    expect(share.code).toContain('return amount * 0 // 100')
  })

  it('a game with no blocks refuses them all', () => {
    expect(generateModules([moduleWith({ type: 'ic_play' })], 'surprise')[0].problems[0]).toMatch('this round')
  })

  it('warns when a path reaches no move, and not when every path does', () => {
    expect(one(moduleWith(null)).warnings.length).toBe(1)
    expect(one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_first_turn' } }, DO0: { block: { type: 'ic_play' } } } })).warnings.length).toBe(1)
    expect(one(moduleWith({ type: 'ic_play' })).warnings).toEqual([])
  })

  it('every example is clean in its own game, and limits hide what they should', () => {
    for (const [game, examples] of Object.entries(EXAMPLES)) {
      expect(examples.length).toBeGreaterThan(0)
      for (const example of examples) {
        const result = generateModules([exampleLayout(example, 'plan')], game)[0]
        expect([example.name, result.problems, result.warnings]).toEqual([example.name, [], []])
      }
    }
    const all = ['logic', 'history', 'chance']
    expect(examplesFor('theatre_of_war', all, 20).length).toBe(EXAMPLES.theatre_of_war.length)
    expect(examplesFor('theatre_of_war', [], 20).map((e) => e.name)).toEqual(['Even spread', 'Strong three', 'Copycat'])
    expect(examplesFor('prisoners_dilemma', all, 2)).toEqual([])
    expect(examplesFor('surprise', all, 20)).toEqual([])
  })
})
