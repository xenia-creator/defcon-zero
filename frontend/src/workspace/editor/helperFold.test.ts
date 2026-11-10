import { describe, expect, it } from 'vitest'
import { EXAMPLES, strategyLayout } from '../blocks/examples'
import { generateStrategy, type StrategyConfig } from '../blocks/generate'
import { newStrategy, type Layout } from '../blocks/layout'
import { splitHelpers } from './helperFold'
import { submissionOf } from './SidePanels'

const AID: StrategyConfig = { moves: [], endowment: 10, multiplier: 3 }
const PD: StrategyConfig = { moves: ['C', 'D'] }

const cases: [string, string, Layout, StrategyConfig][] = [
  ...EXAMPLES.foreign_aid.map((e): [string, string, Layout, StrategyConfig] => [`Round 3 ${e.name}`, 'foreign_aid', strategyLayout(e), AID]),
  ['Round 3 empty strategy', 'foreign_aid', newStrategy('foreign_aid', []), AID],
  ...EXAMPLES.prisoners_dilemma.map((e): [string, string, Layout, StrategyConfig] => [`Round 1 ${e.name}`, 'prisoners_dilemma', strategyLayout(e), PD]),
]

describe('helper fold (display only)', () => {
  it.each(cases)('%s: the submitted code is the raw codegen output, byte for byte', (_, game, layout, config) => {
    const raw = generateStrategy(layout, game, config).code
    const sent = submissionOf({ hand_code: 'ignored in blocks mode', modules: [], strategy_blocks: layout, mode: 'blocks' }, game, config).code
    expect(sent).toBe(raw)
    expect(sent.length).toBe(raw.length)
  })

  it.each(cases.filter(([, game]) => game === 'foreign_aid'))('%s: folds the helpers, and the parts rejoin to the exact code', (_, game, layout, config) => {
    const code = generateStrategy(layout, game, config).code
    const split = splitHelpers(code)
    expect(split).not.toBeNull()
    expect(split!.helpers + split!.strategy).toBe(code)
    expect(split!.strategy.startsWith('def strategy(')).toBe(true)
    expect(split!.helpers).toContain('def legal_send(')
    expect(split!.helpers).toContain('ENDOWMENT = 10')
    expect(split!.helpers).not.toContain('def strategy(')
  })

  it.each(cases.filter(([, game]) => game === 'prisoners_dilemma'))('%s: nothing to fold, so the code shows as it is', (_, game, layout, config) => {
    expect(splitHelpers(generateStrategy(layout, game, config).code)).toBeNull()
  })

  it("leaves a lone import random in view: there's no helper to fold", () => {
    expect(splitHelpers('import random\n\n\ndef strategy(my_history, opp_history):\n    return "C"\n')).toBeNull()
  })

  it('shows the full code when there is no strategy() or no code', () => {
    expect(splitHelpers('')).toBeNull()
    expect(splitHelpers('def legal_send(amount):\n    return amount\n')).toBeNull()
    expect(splitHelpers('def strategy(my_history, opp_history):\n    return "C"\n')).toBeNull()
  })
})
