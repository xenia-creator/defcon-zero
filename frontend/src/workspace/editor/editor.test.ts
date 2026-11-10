import { describe, expect, it } from 'vitest'
import { BLOCKS_MAX_BYTES, CODE_MAX_BYTES, SubmissionDetail } from '../../lib/contract'
import { EXAMPLES, strategyLayout } from '../blocks/examples'
import { generateStrategy } from '../blocks/generate'
import { MAX_BLOCKS_BYTES, MAX_CODE_LENGTH, blocksBytes, parseAgent, utf8Bytes, type Agent } from './drafts'
import { agentFromDetail, toSubmission } from './SidePanels'

describe('workspace byte-size limits (docs/api.md section 5)', () => {
  it('aligns MAX_CODE_LENGTH and MAX_BLOCKS_BYTES with the contract constants', () => {
    expect(MAX_CODE_LENGTH).toBe(CODE_MAX_BYTES)
    expect(MAX_CODE_LENGTH).toBe(65_536)
    expect(MAX_BLOCKS_BYTES).toBe(BLOCKS_MAX_BYTES)
    expect(MAX_BLOCKS_BYTES).toBe(262_144)
  })

  it('measures code and block modules in UTF-8 bytes rather than character length', () => {
    // 1 emoji = 2 UTF-16 code units (.length === 2), 4 UTF-8 bytes
    expect('🚀'.length).toBe(2)
    expect(utf8Bytes('🚀')).toBe(4)
    expect(blocksBytes([])).toBe(utf8Bytes('{"modules":[]}'))
  })
})


describe('blocks mode: what is stored, sent and reopened (docs/api.md section 5)', () => {
  const config = { moves: ['C', 'D'] }
  const tft = EXAMPLES.prisoners_dilemma.find((e) => e.name === 'Tit for Tat')!
  const layout = strategyLayout(tft)
  const agent: Agent = { hand_code: 'def strategy(my_history, opp_history):\n    return "C"\n', modules: [], strategy_blocks: layout, mode: 'blocks' }

  it('a draft keeps the blocks layout, the hand code and the open tab, and older drafts still load', () => {
    expect(parseAgent(agent)).toEqual(agent)
    expect(parseAgent({ hand_code: 'x', modules: [] })).toEqual({ hand_code: 'x', modules: [] })
    expect(parseAgent({ ...agent, mode: 'map' })).toBeNull()
  })

  it('Build with blocks sends the generated strategy.py, with the strategy block as the one module', () => {
    const body = toSubmission(agent, 'prisoners_dilemma', config, 1)
    expect(Object.keys(body).sort()).toEqual(['blocks', 'code', 'round_id'])
    expect(body.code).toBe(generateStrategy(layout, 'prisoners_dilemma', config).code)
    expect(body.blocks).toEqual({ modules: [layout] })
  })

  it('Write code sends the hand code and its modules, never the strategy block', () => {
    const body = toSubmission({ ...agent, mode: 'code' }, 'prisoners_dilemma', config, 1)
    expect(body.code).toBe(agent.hand_code)
    expect(body.blocks).toEqual({ modules: [] })
  })

  it('a version built with blocks reopens in Build with blocks; any other version in Write code', () => {
    // As GET /submissions/{id} returns it, through the contract's own parser
    const detail = (code: string, modules: Record<string, unknown>[]) =>
      SubmissionDetail.parse({ id: 1, round_id: 1, version: 1, status: 'accepted', created_at: '2026-11-12T10:20:11Z', code, blocks: { modules }, check: { error: null, test_results: [] }, server_time: '2026-11-12T10:20:15Z' })
    const sent = toSubmission(agent, 'prisoners_dilemma', config, 1)
    expect(agentFromDetail(detail(sent.code, sent.blocks.modules))).toEqual({ hand_code: sent.code, modules: [], strategy_blocks: layout, mode: 'blocks' })
    expect(agentFromDetail(detail('def strategy(m, o):\n    return "D"\n', []))).toEqual({ hand_code: 'def strategy(m, o):\n    return "D"\n', modules: [], mode: 'code' })
  })
})
