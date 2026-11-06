import { describe, expect, it } from 'vitest'
import { EXAMPLES, exampleLayout, examplesFor } from '../workspace/blocks/examples'
import { assemble, generateModules, handCodeOf } from '../workspace/blocks/generate'
import { countBlocks, moduleName } from '../workspace/blocks/layout'
import { nationNameProblem } from '../workspace/auth/ClaimCountry'
import { newestDraft, parseAgent } from '../workspace/editor/drafts'
import { gameInfo } from '../workspace/editor/games'
import { parseSession } from './auth'
import { Round, SubmissionDetail, Team, Territories, isChecked, isClaimed, territoryName } from './contract'
import { formatDuration, offsetFrom, windowRemaining } from './clock'
import { newId } from './ids'
import { ROUNDS, defconLevel, gameName, moveOption, roundByGame } from './rounds'
import { seesStandings, viewsFor } from '../app/views'
import { moveLabel } from '../workspace/blocks/categories'
import { COUNTRY_FRONT, FRONTS, allocationCode, allocationProblems, evenAllocation, parseAllocation, regionNames } from '../workspace/editor/troops'

describe('clock sync', () => {
  it('uses the midpoint of the round trip', () => {
    // sent at 1000, server says 5050, received at 1100: midpoint 1050, so 4000 ms ahead
    expect(offsetFrom(1000, 5050, 1100)).toBe(4000)
  })

  it('counts down from server time', () => {
    const open = { status: 'open', closesAt: 100_000 }
    expect(windowRemaining(open, 40_000)).toBe(60)
    expect(windowRemaining(open, 200_000)).toBe(0)
    expect(windowRemaining({ ...open, status: 'running' }, 0)).toBeNull()
    expect(windowRemaining({ ...open, closesAt: null }, 0)).toBeNull()
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
  it.each(['not json', 'null', '{}', '[]', '{"access":"a","username":"x"}', '{"access":1,"username":2,"role":3,"team":null}', '{"access":"a","refresh":"b","user":{}}'])(
    'rejects %s',
    (raw) => expect(parseSession(raw)).toBeNull(),
  )

  it('accepts a real one', () => {
    const team = { team_id: 7, nation_name: null, territory_code: null, status: 'alive' }
    expect(parseSession(JSON.stringify({ access: 'a', username: 'team07', role: 'team', team }))?.team?.team_id).toBe(7)
    expect(parseSession(JSON.stringify({ access: 'a', username: 'admin', role: 'organiser', team: null }))?.team).toBeNull()
  })
})

describe('reading the contract', () => {
  const round = {
    id: 1, number: 1, game: 'prisoners_dilemma', status: 'open', opens_at: '2026-11-12T10:00:00Z', closes_at: '2026-11-12T10:45:00Z',
    config: { moves: ['C', 'D'], max_modules: 3, block_limit: 40, rounds_per_match: 200, repetitions: 5 },
    server_time: '2026-11-12T10:12:03Z',
  }

  it('reads the example round from docs/api.md, with dates as times', () => {
    const parsed = Round.parse(round)
    expect(parsed.game).toBe('prisoners_dilemma')
    expect(parsed.config.block_limit).toBe(40)
    expect((parsed.closesAt! - parsed.serverTime!) / 1000).toBe(32 * 60 + 57)
  })

  it('treats a missing or unreadable date as no date, instead of a broken timer', () => {
    expect(Round.parse({ ...round, closes_at: 'soon' }).closesAt).toBeNull()
    expect(Round.parse({ ...round, opens_at: null }).opensAt).toBeNull()
  })

  it('refuses a round with no game, no moves list or a wrong shape', () => {
    expect(Round.safeParse({ ...round, number: 'one' }).success).toBe(false)
    expect(Round.safeParse({ ...round, config: { ...round.config, moves: undefined } }).success).toBe(false)
    expect(Round.safeParse({ ...round, game: undefined }).success).toBe(false)
  })

  it('reads rounds 2 and 3, which have no moves and their own limits', () => {
    const war = Round.parse({ ...round, number: 2, game: 'theatre_of_war', config: { ...round.config, moves: [], troops: 100, regions: 5 } })
    expect(war.config.moves).toEqual([])
    expect([war.config.troops, war.config.regions]).toEqual([100, 5])
    const aid = Round.parse({ ...round, number: 3, game: 'foreign_aid', config: { ...round.config, moves: [], endowment: 10, multiplier: 3 } })
    expect([aid.config.endowment, aid.config.multiplier]).toEqual([10, 3])
    expect(Round.parse(round).config.troops).toBeUndefined()
  })

  it('reads a team, defaulting to active', () => {
    expect(Team.parse({ id: 101, team_id: 7, username: 'x', role: 'team', nation_name: 'Red Dawn', territory_code: 'RU' }).status).toBe('active')
  })

  it('takes the team from team_id, never from the user id', () => {
    const team = Team.parse({ id: 101, team_id: 7, username: 'x', role: 'team', nation_name: null, territory_code: null })
    expect(team.team_id).toBe(7)
    expect('id' in team).toBe(false)
    expect(Team.safeParse({ id: 7, nation_name: null, territory_code: null }).success).toBe(false)
  })

  it('reads a pending submission with no check, and a finished one', () => {
    const pending = SubmissionDetail.parse({ id: 42, version: 4, status: 'pending', code: 'x', blocks: null, check: null })
    expect([pending.error, pending.tests, isChecked(pending.status)]).toEqual([null, [], false])
    const done = SubmissionDetail.parse({ id: 42, version: 4, status: 'accepted', code: 'x', blocks: { modules: [{}] }, check: { error: null, test_results: [{ opponent: 'fortress', my_score: 600, opp_score: 0 }] } })
    expect(done.tests[0].my_score).toBe(600)
    expect(isChecked('running')).toBe(false)
    expect(isChecked('rejected')).toBe(true)
  })

  it('names territories from the code, whichever code style the server uses', () => {
    expect(territoryName('BR')).toBe('Brazil')
    expect(territoryName('BR', 'Federative Brazil')).toBe('Federative Brazil')
    expect(territoryName('not a code')).toBe('not a code')
    expect(Territories.parse({ territories: [{ territory_code: 'RU', claimed: true, nation_name: 'Red Dawn' }, { territory_code: 'BR', claimed: false, nation_name: null }] }).map((t) => t.name)).toEqual(['Brazil', 'Russia'])
  })

  it('an unknown game gets a working editor with no blocks', () => {
    expect(gameInfo('surprise').blocks).toBe(false)
    expect(gameInfo('surprise').template).toContain('def strategy')
  })
})

describe('nation names', () => {
  it.each([['', 'Choose'], ['ab', '3 to 24'], ['x'.repeat(25), '3 to 24'], ['Red-Fox', 'letters']])('rejects %j', (name, why) => expect(nationNameProblem(name)).toContain(why))
  it.each(['Red Fox Republic', 'abc', 'Team 7'])('accepts %j', (name) => expect(nationNameProblem(name)).toBeNull())
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
  const PD = ['C', 'D']
  const moduleWith = (body: unknown, name = 'punish', extra: unknown[] = []) => ({
    blocks: { languageVersion: 0, blocks: [{ type: 'ic_module', fields: { NAME: name }, inputs: body ? { BODY: { block: body } } : {} }, ...extra] },
  })
  const one = (layout: Record<string, unknown>, moves = PD) => generateModules([layout], moves)[0]

  it('writes an if/else from the histories alone, with no engine helpers', () => {
    const result = one(
      moduleWith({
        type: 'controls_ifelse',
        inputs: {
          IF0: { block: { type: 'ic_opp_rate', fields: { MOVE: 'D', OP: 'GT', PERCENT: 60 } } },
          DO0: { block: { type: 'ic_play', fields: { MOVE: 'D' } } },
          ELSE: { block: { type: 'ic_play', fields: { MOVE: 'C' } } },
        },
      }),
    )
    expect(result.problems).toEqual([])
    expect(result.code).toBe('def punish(my_history, opp_history):\n    if opp_history.count("D") > 0.6 * len(opp_history):\n        return "D"\n    else:\n        return "C"\n')
  })

  it('uses whichever moves the round has', () => {
    expect(one(moduleWith({ type: 'ic_play', fields: { MOVE: 'EXPAND' } }), ['ATTACK', 'DEFEND', 'EXPAND']).code).toContain('return "EXPAND"')
    expect(one(moduleWith({ type: 'ic_play', fields: { MOVE: 'WITHHOLD' } }), ['AID', 'WITHHOLD']).problems).toEqual([])
  })

  it("refuses a move that isn't in this round", () => {
    const result = one(moduleWith({ type: 'ic_play', fields: { MOVE: 'ATTACK' } }))
    expect(result.problems[0]).toContain('cooperate, betray')
    expect(result.code).not.toContain('ATTACK')
  })

  it('an empty module is still valid Python', () => {
    expect(one(moduleWith(null)).code).toBe('def punish(my_history, opp_history):\n    return None\n')
  })

  it('reports an if with no condition and loose blocks', () => {
    expect(one(moduleWith({ type: 'controls_ifelse' })).problems).toEqual(['An if block has no condition. Attach one.'])
    expect(one(moduleWith(null, 'punish', [{ type: 'ic_play', fields: { MOVE: 'C' } }])).problems[0]).toMatch('not attached')
  })

  it('never lets layout text reach the Python', () => {
    const evil = '"\nimport os\n#'
    const result = one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: evil } } }, DO0: { block: { type: 'ic_play', fields: { MOVE: evil } } } } }, `x${evil}`))
    expect(result.code).not.toContain('import os')
    expect(result.problems.length).toBeGreaterThan(0)
  })

  it('rejects unknown blocks, and reserved, Python and repeated names', () => {
    expect(one(moduleWith({ type: 'ic_send_troops' })).problems[0]).toMatch("can't be used here")
    expect(one(moduleWith(null, 'strategy')).problems[0]).toMatch('reserved')
    expect(one(moduleWith(null, 'class')).problems[0]).toMatch('Python word')
    expect(generateModules([moduleWith(null), moduleWith(null)], PD)[0].problems[0]).toMatch('Two modules')
  })

  it('survives any JSON and very deep nesting', () => {
    for (const junk of [{}, { blocks: 5 }, { blocks: { blocks: 'x' } }, { blocks: { blocks: [null, 3, { type: 7 }] } }]) expect(() => generateModules([junk], PD)).not.toThrow()
    let deep: Record<string, unknown> = { type: 'ic_play', fields: { MOVE: 'C' } }
    for (let i = 0; i < 20000; i++) deep = { type: 'controls_ifelse', inputs: { DO0: { block: deep } } }
    expect(one(moduleWith(deep)).problems).toContain('Blocks are nested too deeply.')
  })

  it('warns when a path reaches no move, and not when every path does', () => {
    expect(one(moduleWith(null)).warnings.length).toBe(1)
    expect(one(moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_first_turn' } }, DO0: { block: { type: 'ic_play', fields: { MOVE: 'C' } } } } })).warnings.length).toBe(1)
    expect(one(moduleWith({ type: 'ic_play', fields: { MOVE: 'C' } })).warnings).toEqual([])
  })

  it('every example is clean in its own game, and the limit hides what no longer fits', () => {
    for (const [game, examples] of Object.entries(EXAMPLES)) {
      expect(examples.length).toBeGreaterThan(0)
      for (const example of examples) {
        const result = one(exampleLayout(example, 'plan'), gameInfo(game).moves)
        expect([example.name, result.problems, result.warnings]).toEqual([example.name, [], []])
      }
    }
    expect(examplesFor('prisoners_dilemma', 40).length).toBe(EXAMPLES.prisoners_dilemma.length)
    expect(examplesFor('prisoners_dilemma', 2)).toEqual([])
    expect(examplesFor('theatre_of_war', 40)).toEqual([])
    expect(examplesFor('surprise', 40)).toEqual([])
  })

  it('puts blocks after the code, so server line numbers still match strategy.py, and can split them again', () => {
    const hand = 'def strategy(m, o):\n    return plan(m, o)\n'
    expect(assemble(hand, [])).toBe(hand)
    expect(handCodeOf(hand)).toBe(hand)
    const modules = generateModules([moduleWith({ type: 'controls_ifelse', inputs: { IF0: { block: { type: 'ic_chance', fields: { PERCENT: 10 } } }, DO0: { block: { type: 'ic_play', fields: { MOVE: 'C' } } }, ELSE: { block: { type: 'ic_play', fields: { MOVE: 'D' } } } } }, 'plan')], PD)
    const code = assemble(hand, modules)
    expect(code.startsWith(hand)).toBe(true)
    expect(code).toContain('import random')
    expect(code).toContain('def plan(my_history, opp_history):')
    expect(handCodeOf(code)).toBe(hand)
  })
})

describe('rounds 2 and 3 in the editor', () => {
  const config = { moves: [], max_modules: 3, block_limit: 40 }

  it('take their limits from the round config, not from fixed numbers', () => {
    const war = gameInfo('theatre_of_war', { ...config, troops: 60, regions: 3 })
    expect(war.blocks).toBe(false)
    expect(war.template).toContain('return [20, 20, 20]')
    expect(war.template).toContain('add up to 60')
    expect(war.limits).toBe('Return 3 whole numbers, none negative, adding up to 60.')

    const aid = gameInfo('foreign_aid', { ...config, endowment: 20, multiplier: 4 })
    expect(aid.blocks).toBe(false)
    expect(aid.template).toContain('from 0 to 20')
    expect(aid.template).toContain('received = 4 * opp_history[-1]')
    expect(aid.template).toContain('return 10')
  })

  it('match the event before the round arrives: 100 troops over 5 regions, 10 points tripled', () => {
    expect(gameInfo('theatre_of_war').template).toContain('return [20, 20, 20, 20, 20]')
    expect(gameInfo('foreign_aid').template).toContain('received = 3 * opp_history[-1]')
  })

  it('split troops that do not divide evenly without losing any', () => {
    expect(gameInfo('theatre_of_war', { ...config, troops: 101, regions: 5 }).template).toContain('return [21, 20, 20, 20, 20]')
  })
})

describe('who sees what', () => {
  const team = { team_id: 7, nation_name: 'Red Dawn', territory_code: 'RU', status: 'active' }

  it('a team gets only its own workspace: no war map, no standings, no Command Console', () => {
    expect(viewsFor({ role: 'team', team })).toEqual(['workspace'])
    expect(seesStandings({ role: 'team' })).toBe(false)
    // A team account not yet linked to a team gets nothing, not the map
    expect(viewsFor({ role: 'team', team: null })).toEqual([])
  })

  it('only the organiser gets the Command Console and the standings', () => {
    expect(viewsFor({ role: 'organiser', team: null })).toEqual(['warmap', 'command'])
    expect(seesStandings({ role: 'organiser' })).toBe(true)
    for (const role of ['spectator', 'admin', 'team', '']) {
      expect(viewsFor({ role, team: null })).not.toContain('command')
      expect(seesStandings({ role })).toBe(false)
    }
  })

  it('a spectator gets the war map only', () => {
    expect(viewsFor({ role: 'spectator', team: null })).toEqual(['warmap'])
  })

  it("reads a team's own score from /me, and copes without one", () => {
    expect(Team.parse({ id: 101, team_id: 7, nation_name: 'Red Dawn', territory_code: 'RU', score: 860 }).score).toBe(860)
    expect(Team.parse({ id: 101, team_id: 7, nation_name: 'Red Dawn', territory_code: 'RU' }).score).toBeUndefined()
  })
})

describe('the round table', () => {
  it('pairs each round with its game, name and DEFCON level', () => {
    expect(ROUNDS.map((r) => [r.number, r.defcon, r.game, r.name])).toEqual([
      [1, 3, 'prisoners_dilemma', "The Prisoner's Dilemma"],
      [2, 2, 'theatre_of_war', 'Theatre of War'],
      [3, 1, 'foreign_aid', 'Foreign Aid'],
    ])
    expect(roundByGame('theatre_of_war')?.also).toBe('Colonel Blotto')
    expect(roundByGame('foreign_aid')?.also).toBe('The Trust Game')
  })

  it('names each game the same way in the editor', () => {
    for (const r of ROUNDS) expect(gameInfo(r.game).name).toBe(r.name)
    expect(gameName('surprise')).toBe('surprise')
  })

  it('counts DEFCON down, reaching ZERO only when round 3 is published', () => {
    expect([1, 2, 3].map((number) => defconLevel({ number, status: 'open' }))).toEqual([3, 2, 1])
    expect(defconLevel({ number: 3, status: 'published' })).toBe(0)
    expect(defconLevel({ number: 2, status: 'published' })).toBe(2)
    expect(defconLevel(null)).toBe(3)
  })

  it('shows round 1 options as Cooperate (C) and Betray (D)', () => {
    expect(['C', 'D'].map((m) => moveOption(m, moveLabel(m)))).toEqual(['Cooperate (C)', 'Betray (D)'])
  })
})

describe('round 2 on the map', () => {
  it('has five named fronts, and every country on the map belongs to one', () => {
    expect(FRONTS.map((f) => f.name)).toEqual(['Americas', 'Europe', 'Africa & Middle East', 'Asia', 'Oceania'])
    expect(regionNames(5)).toEqual(FRONTS.map((f) => f.name))
    expect(regionNames(3)).toEqual(['Region 1', 'Region 2', 'Region 3'])
    const of = (code: string) => FRONTS[COUNTRY_FRONT.get(code)!].name
    expect(['US', 'BR', 'CA'].map(of)).toEqual(['Americas', 'Americas', 'Americas'])
    expect(['FR', 'DE', 'TR'].map(of)).toEqual(['Europe', 'Europe', 'Europe'])
    expect(['NG', 'EG', 'SA'].map(of)).toEqual(['Africa & Middle East', 'Africa & Middle East', 'Africa & Middle East'])
    expect(['CN', 'IN', 'JP', 'RU'].map(of)).toEqual(['Asia', 'Asia', 'Asia', 'Asia'])
    expect(['AU', 'NZ'].map(of)).toEqual(['Oceania', 'Oceania'])
    for (const i of new Set(COUNTRY_FRONT.values())) expect(i).toBeLessThan(FRONTS.length)
  })

  it('only accepts exactly 100 whole, non-negative troops', () => {
    expect(allocationProblems([20, 20, 20, 20, 20], 100, 5)).toEqual([])
    expect(allocationProblems([0, 0, 0, 0, 100], 100, 5)).toEqual([])
    expect(allocationProblems([20, 20, 20, 20, 19], 100, 5)[0]).toContain('Place 1 more')
    expect(allocationProblems([30, 20, 20, 20, 20], 100, 5)[0]).toContain('Remove 10')
    expect(allocationProblems([-5, 30, 25, 25, 25], 100, 5)).toContain('No region can have fewer than 0 troops.')
    expect(allocationProblems([20.5, 19.5, 20, 20, 20], 100, 5)).toContain('Troops must be whole numbers.')
    expect(allocationProblems([25, 25, 25, 25], 100, 5)[0]).toContain('exactly 5 regions')
  })

  it('turns a placement into a fixed strategy, and reads it back', () => {
    const code = allocationCode([35, 10, 25, 20, 10], regionNames(5))
    expect(code).toContain('def strategy(my_history, opp_history):\n    return [35, 10, 25, 20, 10]\n')
    expect(code).toContain('#   1. Americas: 35')
    expect(parseAllocation(code, 5)).toEqual([35, 10, 25, 20, 10])
    // Hand-written or adaptive code opens in the editor instead
    expect(parseAllocation(gameInfo('theatre_of_war').template, 5)).toBeNull()
    expect(parseAllocation('def strategy(my_history, opp_history):\n    return [50, 50]\n', 5)).toBeNull()
    expect(evenAllocation(100, 5)).toEqual([20, 20, 20, 20, 20])
    expect(evenAllocation(101, 5)).toEqual([21, 20, 20, 20, 20])
  })
})

describe('a team that has not claimed its nation yet', () => {
  it('can log in: /me with team_id null parses, and counts as unclaimed', () => {
    const fresh = Team.parse({ id: 101, team_id: null, username: 'team1', role: 'team', nation_name: null, territory_code: null })
    expect(fresh.team_id).toBeNull()
    expect(isClaimed(fresh)).toBe(false)
    const claimed = Team.parse({ id: 101, team_id: 7, username: 'team1', role: 'team', nation_name: 'Red Dawn', territory_code: 'RU' })
    expect(isClaimed(claimed)).toBe(true)
    expect(isClaimed(null)).toBe(false)
  })

  it('still needs team_id to be sent, even as null', () => {
    expect(Team.safeParse({ id: 101, nation_name: null, territory_code: null }).success).toBe(false)
  })

  it('survives a reload: a stored unclaimed session is still valid', () => {
    const team = { team_id: null, nation_name: null, territory_code: null, status: 'active' }
    expect(parseSession(JSON.stringify({ access: 'a', username: 'team1', role: 'team', team }))?.team?.team_id).toBeNull()
  })
})
