// @vitest-environment node
/**
 * The guided tutorial's checks (frontend/docs/BLOCKS.md part 2): every step's passing layout, each
 * near-miss and its hint, going back after a deletion, and that both finished tutorials generate
 * Python with no problems. The finished Round 3 bot is also played in the engine.
 */
import { describe, expect, it } from 'vitest'
import { generateStrategy } from './generate'
import type { BlockState, Layout } from './layout'
import {
  TUTORIALS,
  canvasEmpty,
  readSession,
  readTutorialState,
  sessionKey,
  shouldAutoStartTutorial,
  tutorialKey,
  tutorialProgress,
  writeSession,
  writeTutorialState,
  type TutorialEvents,
  type TutorialGame,
} from './tutorial'

const canvas = (...blocks: BlockState[]): Layout => ({ blocks: { languageVersion: 0, blocks } })
const events = (read: string[] = [], submitted = false, windowClosed = false): TutorialEvents => ({ read, submitted, windowClosed })
const at = (game: TutorialGame, layout: Layout, e = events()) => tutorialProgress(game, layout, e)

// ---- Round 1 layouts ----
const play = (MOVE: string): BlockState => ({ type: 'ic_play', fields: { MOVE } })
const oppLast = (MOVE: string): BlockState => ({ type: 'ic_opp_last', fields: { MOVE } })
const chance = (PERCENT: number): BlockState => ({ type: 'ic_chance', fields: { PERCENT } })
const ifThen = (condition?: BlockState, then?: BlockState, next?: BlockState): BlockState => ({
  type: 'ic_if',
  inputs: { ...(condition ? { IF0: { block: condition } } : {}), ...(then ? { DO0: { block: then } } : {}) },
  ...(next ? { next: { block: next } } : {}),
})
const pd = (body?: BlockState, ...loose: BlockState[]) => canvas({ type: 'ic_strategy', fields: { FALLBACK: 'C' }, ...(body ? { inputs: { BODY: { block: body } } } : {}) }, ...loose)

const PD_READ_1 = events(['pd-meet'])
const PD_READ_BOTH = events(['pd-meet', 'pd-python'])
/** Forgiving Tit for Tat as the tutorial builds it: the chance-if above play betray, inside the outer if. */
const pdFinished = (pct = 10) => pd(ifThen(oppLast('D'), ifThen(chance(pct), play('C'), play('D'))))

// ---- Round 3 layouts ----
const shadowNum = (NUM: number) => ({ shadow: { type: 'fa_number', fields: { NUM } } })
const send = (amount: object = shadowNum(5)): BlockState => ({ type: 'fa_send', inputs: { AMOUNT: amount } })
const sendBack = (amount: object = shadowNum(5)): BlockState => ({ type: 'fa_return', inputs: { AMOUNT: amount } })
const fa = (opts: { send?: BlockState; receive?: BlockState; sendDefault?: number; returnPct?: number } = {}, ...loose: BlockState[]) =>
  canvas(
    {
      type: 'fa_strategy',
      fields: { SEND_DEFAULT: opts.sendDefault ?? 5, RETURN_PCT_DEFAULT: opts.returnPct ?? 50 },
      inputs: { ...(opts.send ? { SEND: { block: opts.send } } : {}), ...(opts.receive ? { RECEIVE: { block: opts.receive } } : {}) },
    },
    ...loose,
  )
const FA_READ = events(['fa-roles'])
const short: BlockState = { type: 'fa_opp_ever_short' }
const sentLast = { block: { type: 'fa_opp_sent_last' } }
/** Grudger with a fair send-back, as the tutorial builds it (the 5 under "send back" is covered, so kept as a shadow). */
const faFinished = () =>
  fa({ sendDefault: 10, send: ifThen(short, send(shadowNum(0))), receive: sendBack({ ...sentLast, ...shadowNum(5) }) })

describe('the Round 1 tutorial: Forgiving Tit for Tat', () => {
  it('has the 7 steps of BLOCKS.md 2.2, in order', () => {
    expect(TUTORIALS.prisoners_dilemma.map((s) => s.id)).toEqual(['pd-meet', 'pd-if', 'pd-react', 'pd-hit-back', 'pd-python', 'pd-forgive', 'pd-send'])
    expect(TUTORIALS.prisoners_dilemma.filter((s) => s.read).map((s) => s.id)).toEqual(['pd-meet', 'pd-python'])
  })

  it('step 1 waits for Next', () => {
    expect(at('prisoners_dilemma', pd()).step.id).toBe('pd-meet')
    expect(at('prisoners_dilemma', pd(), PD_READ_1).step.id).toBe('pd-if')
  })

  it('step 2: an if inside the strategy passes, and if/else passes too', () => {
    expect(at('prisoners_dilemma', pd(ifThen()), PD_READ_1).step.id).toBe('pd-react')
    expect(at('prisoners_dilemma', pd({ type: 'controls_ifelse' }), PD_READ_1).step.id).toBe('pd-react')
  })

  it('step 2 hint: the if is on the canvas but not inside the strategy', () => {
    const p = at('prisoners_dilemma', pd(undefined, ifThen()), PD_READ_1)
    expect(p.step.id).toBe('pd-if')
    expect(p.hint).toBe("Drop it inside the strategy block, under 'My strategy, every turn'.")
  })

  it('step 3: opponent betrayed last turn in the if passes; cooperated, or outside the slot, gets a hint', () => {
    expect(at('prisoners_dilemma', pd(ifThen(oppLast('D'))), PD_READ_1).step.id).toBe('pd-hit-back')
    expect(at('prisoners_dilemma', pd(ifThen(oppLast('C'))), PD_READ_1)).toMatchObject({ index: 2, hint: 'Almost: set the dropdown to betrayed.' })
    expect(at('prisoners_dilemma', pd(ifThen(), oppLast('D')), PD_READ_1)).toMatchObject({ index: 2, hint: 'Drop it into the hexagon-shaped gap after "if".' })
  })

  it('step 4: play betray inside then passes; cooperate, or under the if, gets a hint', () => {
    expect(at('prisoners_dilemma', pd(ifThen(oppLast('D'), play('D'))), PD_READ_1).step.id).toBe('pd-python')
    expect(at('prisoners_dilemma', pd(ifThen(oppLast('D'), play('C'))), PD_READ_1).hint).toBe('Set it to betray, so a betrayal gets a betrayal back.')
    expect(at('prisoners_dilemma', pd(ifThen(oppLast('D'), undefined, play('D'))), PD_READ_1).hint).toBe(
      'Put it inside the "then" gap, so it only plays when the opponent betrayed.',
    )
  })

  it('step 5 waits for Next', () => {
    const tft = pd(ifThen(oppLast('D'), play('D')))
    expect(at('prisoners_dilemma', tft, PD_READ_1).step.id).toBe('pd-python')
    expect(at('prisoners_dilemma', tft, PD_READ_BOTH).step.id).toBe('pd-forgive')
  })

  it('step 6: a chance-if with play cooperate above play betray passes, from 1 to 50 %', () => {
    for (const pct of [1, 10, 50]) expect(at('prisoners_dilemma', pdFinished(pct), PD_READ_BOTH).step.id).toBe('pd-send')
    // if/else with betray in "otherwise" passes too
    const ifElse = pd(ifThen(oppLast('D'), { type: 'controls_ifelse', inputs: { IF0: { block: chance(10) }, DO0: { block: play('C') }, ELSE: { block: play('D') } } }))
    expect(at('prisoners_dilemma', ifElse, PD_READ_BOTH).step.id).toBe('pd-send')
  })

  it('step 6 hints: forgiving too often, or no betray left after it', () => {
    expect(at('prisoners_dilemma', pdFinished(80), PD_READ_BOTH)).toMatchObject({ index: 5, hint: 'That forgives most betrayals. Try something like 10.' })
    const noBetrayAfter = pd(ifThen(oppLast('D'), ifThen(chance(10), play('C'))))
    expect(at('prisoners_dilemma', noBetrayAfter, PD_READ_BOTH)).toMatchObject({ index: 3 })
    const betrayButNotAfter = pd(ifThen(oppLast('D'), play('D')), ifThen(chance(10), play('C')))
    expect(at('prisoners_dilemma', betrayButNotAfter, PD_READ_BOTH).step.id).toBe('pd-forgive')
  })

  it('step 7 passes on a new version, or when the window is closed', () => {
    expect(at('prisoners_dilemma', pdFinished(), PD_READ_BOTH)).toMatchObject({ index: 6, finished: false })
    expect(at('prisoners_dilemma', pdFinished(), events(['pd-meet', 'pd-python'], true)).finished).toBe(true)
    // With the window closed it waits for Finish
    expect(at('prisoners_dilemma', pdFinished(), events(['pd-meet', 'pd-python'], false, true)).finished).toBe(false)
    expect(at('prisoners_dilemma', pdFinished(), events(['pd-meet', 'pd-python', 'pd-send'], false, true)).finished).toBe(true)
    expect(at('prisoners_dilemma', pdFinished(), events(['pd-meet', 'pd-python', 'pd-send'])).finished).toBe(false)
  })

  it('goes back to the step a deleted block belonged to, and carries on once it is back', () => {
    const done = events(['pd-meet', 'pd-python'])
    expect(at('prisoners_dilemma', pdFinished(), done).step.id).toBe('pd-send')
    expect(at('prisoners_dilemma', pd(ifThen(undefined, ifThen(chance(10), play('C'), play('D')))), done).step.id).toBe('pd-react')
    expect(at('prisoners_dilemma', pd(), done).step.id).toBe('pd-if')
    expect(at('prisoners_dilemma', pdFinished(), done).step.id).toBe('pd-send')
  })

  it('the finished layout generates Python with no problems, within 8 blocks', () => {
    const result = generateStrategy(pdFinished(), 'prisoners_dilemma', { moves: ['C', 'D'] })
    expect(result.problems).toEqual([])
    expect(result.code).toContain('if random.random() < 0.1:')
  })
})

describe('the Round 3 tutorial: Grudger with a fair send-back', () => {
  it('has the 7 steps of BLOCKS.md 2.3, in order', () => {
    expect(TUTORIALS.foreign_aid.map((s) => s.id)).toEqual(['fa-roles', 'fa-trust', 'fa-if', 'fa-cheated', 'fa-stop', 'fa-fair', 'fa-send'])
  })

  it('step 1 waits for Next; step 2 wants send 10 as the sending fallback', () => {
    expect(at('foreign_aid', fa()).step.id).toBe('fa-roles')
    expect(at('foreign_aid', fa(), FA_READ).step.id).toBe('fa-trust')
    expect(at('foreign_aid', fa({ sendDefault: 10 }), FA_READ).step.id).toBe('fa-if')
  })

  it('step 2 hint: the receiving fallback was changed instead', () => {
    expect(at('foreign_aid', fa({ returnPct: 100 }), FA_READ).hint).toBe('That\'s the receiving fallback. Change the one under "when I\'m sending".')
    expect(at('foreign_aid', fa(), FA_READ).hint).toBeNull()
  })

  it('step 3: an if in the sending section passes; in the receiving section it gets a hint', () => {
    expect(at('foreign_aid', fa({ sendDefault: 10, send: ifThen() }), FA_READ).step.id).toBe('fa-cheated')
    expect(at('foreign_aid', fa({ sendDefault: 10, receive: ifThen() }), FA_READ)).toMatchObject({
      index: 2,
      hint: 'That\'s the receiving section. Drag it up into "when I\'m sending".',
    })
  })

  it('step 4: has-ever-short-changed passes; another opponent block gets a hint', () => {
    expect(at('foreign_aid', fa({ sendDefault: 10, send: ifThen(short) }), FA_READ).step.id).toBe('fa-stop')
    const wrong = fa({ sendDefault: 10, send: ifThen({ type: 'fa_compare', inputs: { A: sentLast, B: shadowNum(5) } }) })
    expect(at('foreign_aid', wrong, FA_READ).hint).toBe('Close, but this step needs "has ever sent back less than I sent".')
  })

  it('step 5: send 0 inside then passes, as a shadow or a real number; send back, or another number, gets a hint', () => {
    expect(at('foreign_aid', fa({ sendDefault: 10, send: ifThen(short, send(shadowNum(0))) }), FA_READ).step.id).toBe('fa-fair')
    expect(at('foreign_aid', fa({ sendDefault: 10, send: ifThen(short, send({ block: { type: 'fa_number', fields: { NUM: 0 } } })) }), FA_READ).step.id).toBe('fa-fair')
    expect(at('foreign_aid', fa({ sendDefault: 10, send: ifThen(short, sendBack()) }), FA_READ).hint).toBe('When sending, use "send". "Send back" is for the receiving section.')
    expect(at('foreign_aid', fa({ sendDefault: 10, send: ifThen(short, send(shadowNum(5))) }), FA_READ).hint).toBe('Set the number to 0, so a cheater gets nothing.')
  })

  it('step 6: send back what the opponent sent last passes, or send back 34 % or more', () => {
    expect(at('foreign_aid', faFinished(), FA_READ).step.id).toBe('fa-send')
    const pct = (PERCENT: number) => fa({ sendDefault: 10, send: ifThen(short, send(shadowNum(0))), receive: { type: 'fa_return_pct', fields: { PERCENT } } })
    expect(at('foreign_aid', pct(34), FA_READ).step.id).toBe('fa-send')
    expect(at('foreign_aid', pct(33), FA_READ).step.id).toBe('fa-fair')
  })

  it('step 6 hints: send in the receiving section, the number not yet swapped, a loose block', () => {
    const base = { sendDefault: 10, send: ifThen(short, send(shadowNum(0))) }
    expect(at('foreign_aid', fa({ ...base, receive: send() }), FA_READ).hint).toBe("Use 'send back' under 'when I'm receiving'.")
    expect(at('foreign_aid', fa({ ...base, receive: sendBack() }), FA_READ).hint).toBe('Drop "what the opponent sent last" right on top of the number to swap it in.')
    // A real number block pushed out by the drop (the old, non-shadow case) holds the step until it is gone
    const loose = fa({ ...base, receive: sendBack(sentLast) }, { type: 'fa_number', fields: { NUM: 5 } })
    expect(at('foreign_aid', loose, FA_READ)).toMatchObject({ index: 5, hint: 'A block is outside your strategy. Delete it (drag it to the bin) or put it inside.' })
  })

  it('step 7 passes on a new version, or when the window is closed', () => {
    expect(at('foreign_aid', faFinished(), FA_READ).step.submit).toBe(true)
    expect(at('foreign_aid', faFinished(), events(['fa-roles'], true)).finished).toBe(true)
    expect(at('foreign_aid', faFinished(), events(['fa-roles'], false, true)).finished).toBe(false)
    expect(at('foreign_aid', faFinished(), events(['fa-roles', 'fa-send'], false, true)).finished).toBe(true)
  })

  it('goes back after a deletion: removing the if returns to step 3', () => {
    expect(at('foreign_aid', fa({ sendDefault: 10, receive: sendBack(sentLast) }), FA_READ).step.id).toBe('fa-if')
  })

  it('the finished layout generates Python with no problems and plays only legal amounts in the engine', async () => {
    const result = generateStrategy(faFinished(), 'foreign_aid', { moves: [], endowment: 10, multiplier: 3 })
    expect(result.problems).toEqual([])
    expect(result.code).toContain('return legal_send(0)')
    expect(result.code).toContain('return legal_return((opp_sent[-1] if opp_sent else 0), received)')
    const [played] = (await playForeignAid())([result.code])
    expect(played).toMatchObject({ problems: [] })
    expect(played.calls).toBeGreaterThan(0)
  })
})

describe('remembered per browser, and resuming in a tab', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  }
  const broken = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('quota')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }

  it('stores done or skipped under dz.tutorial.<game>, and ignores anything else', () => {
    const s = memory()
    expect(tutorialKey('foreign_aid')).toBe('dz.tutorial.foreign_aid')
    expect(readTutorialState('foreign_aid', s)).toBeNull()
    writeTutorialState('foreign_aid', 'skipped', s)
    expect(readTutorialState('foreign_aid', s)).toBe('skipped')
    s.setItem(tutorialKey('prisoners_dilemma'), 'later')
    expect(readTutorialState('prisoners_dilemma', s)).toBeNull()
  })

  it('keeps the open tutorial for the tab, with the blocks it replaced, and drops a damaged one', () => {
    const s = memory()
    const saved = pd(ifThen(oppLast('D'), play('D')))
    writeSession('prisoners_dilemma', { read: ['pd-meet'], saved, startVersion: 3 }, s)
    expect(readSession('prisoners_dilemma', s)).toEqual({ read: ['pd-meet'], saved, startVersion: 3 })
    s.setItem(sessionKey('prisoners_dilemma'), '{"read":"x"}')
    expect(readSession('prisoners_dilemma', s)).toBeNull()
    writeSession('prisoners_dilemma', null, s)
    expect(readSession('prisoners_dilemma', s)).toBeNull()
  })

  it('storage that throws never breaks it', () => {
    expect(readTutorialState('prisoners_dilemma', broken)).toBeNull()
    expect(() => writeTutorialState('prisoners_dilemma', 'done', broken)).not.toThrow()
    expect(readSession('prisoners_dilemma', broken)).toBeNull()
    expect(() => writeSession('prisoners_dilemma', { read: [], saved: null, startVersion: null }, broken)).not.toThrow()
  })
})

describe('starting by itself', () => {
  const base = { game: 'prisoners_dilemma', blocksMode: true, fallen: false, canvasEmpty: true, stored: null, automated: false, tourSettled: true }

  it('starts the first time on an empty strategy in Build with blocks, once the screen tour is out of the way', () => {
    expect(shouldAutoStartTutorial(base)).toBe(true)
    expect(shouldAutoStartTutorial({ ...base, game: 'foreign_aid' })).toBe(true)
  })

  it('never in Round 2, in Write code, for a fallen team, over existing work, after done or skipped, or under automation', () => {
    expect(shouldAutoStartTutorial({ ...base, game: 'theatre_of_war' })).toBe(false)
    expect(shouldAutoStartTutorial({ ...base, blocksMode: false })).toBe(false)
    expect(shouldAutoStartTutorial({ ...base, fallen: true })).toBe(false)
    expect(shouldAutoStartTutorial({ ...base, canvasEmpty: false })).toBe(false)
    expect(shouldAutoStartTutorial({ ...base, stored: 'done' })).toBe(false)
    expect(shouldAutoStartTutorial({ ...base, stored: 'skipped' })).toBe(false)
    expect(shouldAutoStartTutorial({ ...base, automated: true })).toBe(false)
  })

  it('waits while the screen tour may still run', () => {
    expect(shouldAutoStartTutorial({ ...base, tourSettled: false })).toBe(false)
  })

  it('an empty canvas is just the strategy block, with nothing inside', () => {
    expect(canvasEmpty(pd())).toBe(true)
    expect(canvasEmpty(fa())).toBe(true)
    expect(canvasEmpty(pd(ifThen()))).toBe(false)
    expect(canvasEmpty(pd(undefined, ifThen()))).toBe(false)
    expect(canvasEmpty(null)).toBe(true)
  })
})

// ---- the engine, as generate.test.ts runs it ----

type Played = { calls: number; problems: string[] }
type Node = { spawnSync: (cmd: string, args: string[], o: { input?: string; encoding: 'utf8'; maxBuffer?: number }) => { status: number | null; stdout: string; stderr: string; error?: Error } }

/** Plays block bots in the engine's Foreign Aid (play_foreign_aid.py, which only reads engine/). Needs Python 3.11+. */
async function playForeignAid(): Promise<(bots: string[]) => Played[]> {
  const childProcess = 'node:child_process'
  const url = 'node:url'
  const { spawnSync } = (await import(/* @vite-ignore */ childProcess)) as Node
  const { fileURLToPath } = (await import(/* @vite-ignore */ url)) as { fileURLToPath: (u: URL) => string }
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const script = fileURLToPath(new URL('play_foreign_aid.py', import.meta.url))
  return (bots) => {
    const result = spawnSync('python3', ['-I', script, root], { input: JSON.stringify({ bots, turns: 60, seeds: [1, 2] }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`python3 failed (Python 3.11 or newer is needed):\n${result.stderr}`)
    return JSON.parse(result.stdout) as Played[]
  }
}
