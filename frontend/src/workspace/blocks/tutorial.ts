/**
 * The guided blocks tutorial (frontend/docs/BLOCKS.md part 2): its steps, and which step a team is
 * on. Every check reads only the saved layout JSON, like generate.ts, so it is unit-tested without
 * Blockly. Progress follows the layout: delete a block an earlier step needed, and the tutorial
 * goes back to that step.
 */
import { CATEGORY, FA_MISPLACED } from './categories'
import { slotValue, topBlocks, type BlockState, type Layout } from './layout'

export type TutorialGame = 'prisoners_dilemma' | 'foreign_aid'
export const TUTORIAL_GAMES: readonly string[] = ['prisoners_dilemma', 'foreign_aid']
export const hasTutorial = (game: string): game is TutorialGame => TUTORIAL_GAMES.includes(game)

/** What the team did that the layout can't show: Next on the reading steps, and the submit step. */
export type TutorialEvents = {
  /** Ids of reading steps the team pressed Next on. */
  read: readonly string[]
  /** A new version was created while the tutorial was open. */
  submitted: boolean
  /** The submission window is closed, so the submit step can be finished without submitting. */
  windowClosed: boolean
}

/** What a step points at, for the highlight. */
export type Highlight =
  | { kind: 'category'; id: string }
  | { kind: 'block'; type: string }
  | { kind: 'field'; type: string; field: string }
  | { kind: 'input'; type: string; input: string }
  | { kind: 'tour'; target: 'python' | 'submit' | 'examples' }

export type TutorialStep = {
  id: string
  title: string
  text: string
  /** A reading step: nothing to build, it has a Next button. */
  read?: boolean
  /** The submit step: passes on a new version, or Finish when the window is closed. */
  submit?: boolean
  highlight: Highlight[]
  /** Shown after 20 seconds with no change. */
  general: string
  check: (layout: Layout, events: TutorialEvents) => boolean
  /** A targeted hint for a common near-miss, shown straight away, or null. */
  hint?: (layout: Layout) => string | null
}

// ---- reading a layout ----

type Chain = BlockState[]

/** A statement chain: the block and everything linked under it through `next`. */
function chain(first: BlockState | undefined, limit = 200): Chain {
  const out: Chain = []
  for (let b = first; b && out.length < limit; b = b.next?.block) out.push(b)
  return out
}

const isIf = (b: BlockState | undefined) => b?.type === 'ic_if' || b?.type === 'controls_ifelse'
const strategyBlock = (layout: Layout, type: string) => topBlocks(layout).find((b) => b.type === type)
const statements = (block: BlockState | undefined, input: string): Chain => chain(block?.inputs?.[input]?.block)
const firstIf = (c: Chain) => c.find(isIf)
const looseTop = (layout: Layout, rootType: string) => topBlocks(layout).filter((b) => b.type !== rootType)

/** Every block anywhere in a tree, to spot one that exists but is in the wrong place. */
function everyBlock(layout: Layout): BlockState[] {
  const out: BlockState[] = []
  const walk = (b: BlockState | undefined, depth: number) => {
    if (!b || depth > 500) return
    out.push(b)
    for (const slot of Object.values(b.inputs ?? {})) walk(slotValue(slot), depth + 1)
    walk(b.next?.block, depth + 1)
  }
  topBlocks(layout).forEach((b) => walk(b, 0))
  return out
}

const play = (b: BlockState | undefined, move: string) => b?.type === 'ic_play' && b.fields?.MOVE === move
const percent = (b: BlockState | undefined) => Number(b?.fields?.PERCENT)
const readStep = (id: string) => (_layout: Layout, events: TutorialEvents) => events.read.includes(id)
/** A new version appears, or, with the window closed, the team presses Finish (recorded like a read). */
const submitStep = (id: string) => (_layout: Layout, events: TutorialEvents) => events.submitted || (events.windowClosed && events.read.includes(id))

// ---- Round 1: build Forgiving Tit for Tat ----

const pdBody = (layout: Layout) => statements(strategyBlock(layout, 'ic_strategy'), 'BODY')
const pdIf = (layout: Layout) => firstIf(pdBody(layout))
const pdThen = (layout: Layout) => statements(pdIf(layout), 'DO0')
/**
 * Betray is still played in "then": directly, or as the "otherwise" of an if/else, which is how
 * step 6's if/else form keeps it. Either way a betrayal gets a betrayal back.
 */
const betraysInThen = (layout: Layout) =>
  pdThen(layout).some((b) => play(b, 'D') || (b.type === 'controls_ifelse' && chain(b.inputs?.ELSE?.block).some((c) => play(c, 'D'))))

/** The forgiving branch inside the outer if: a chance-if that plays cooperate, with a betray still reached after it. */
function forgiving(layout: Layout): { inner?: BlockState; betrayAfter: boolean } {
  const then = pdThen(layout)
  const at = then.findIndex((b) => isIf(b) && b.inputs?.IF0?.block?.type === 'ic_chance')
  if (at === -1) return { betrayAfter: false }
  const inner = then[at]
  const betrayAfter = then.slice(at + 1).some((b) => play(b, 'D')) || chain(inner.inputs?.ELSE?.block).some((b) => play(b, 'D'))
  return { inner, betrayAfter }
}

const ROUND_1: TutorialStep[] = [
  {
    id: 'pd-meet',
    title: 'Meet your strategy',
    text: 'This block is your bot. Every turn it reads from the top, and the first move it reaches is what it plays. Right now nothing is inside, so it always plays the move at the bottom: cooperate. The Python below is what the server runs.',
    read: true,
    highlight: [{ kind: 'block', type: 'ic_strategy' }, { kind: 'tour', target: 'python' }],
    general: 'Press Next when you have read this.',
    check: readStep('pd-meet'),
  },
  {
    id: 'pd-if',
    title: 'Add a decision',
    text: 'Open Logic and drag "if … then" into your strategy block.',
    highlight: [{ kind: 'category', id: CATEGORY.logic.id }, { kind: 'input', type: 'ic_strategy', input: 'BODY' }],
    general: 'The Logic category is on the left. Drag the "if … then" block into the gap under "My strategy, every turn".',
    check: (layout) => pdIf(layout) !== undefined,
    hint: (layout) => (looseTop(layout, 'ic_strategy').some(isIf) ? "Drop it inside the strategy block, under 'My strategy, every turn'." : null),
  },
  {
    id: 'pd-react',
    title: 'What are you reacting to?',
    text: 'Open Opponent and drag "opponent betrayed last turn" into the gap after "if".',
    highlight: [{ kind: 'category', id: CATEGORY.opponent.id }, { kind: 'block', type: 'ic_if' }],
    general: 'Find "opponent … last turn" in Opponent and drop it into the hexagon-shaped gap after "if".',
    check: (layout) => {
      const condition = pdIf(layout)?.inputs?.IF0?.block
      return condition?.type === 'ic_opp_last' && condition.fields?.MOVE === 'D'
    },
    hint: (layout) => {
      const condition = pdIf(layout)?.inputs?.IF0?.block
      if (condition?.type === 'ic_opp_last' && condition.fields?.MOVE !== 'D') return 'Almost: set the dropdown to betrayed.'
      if (!condition && everyBlock(layout).some((b) => b.type === 'ic_opp_last')) return 'Drop it into the hexagon-shaped gap after "if".'
      return null
    },
  },
  {
    id: 'pd-hit-back',
    title: 'Hit back',
    text: "Open Actions and drag \"play\" into the \"then\" gap. Set it to betray. You've built Tit for Tat: be nice, but hit back.",
    highlight: [{ kind: 'category', id: CATEGORY.actions.id }, { kind: 'block', type: 'ic_if' }],
    general: 'Drag "play" from Actions into the "then" gap, and set its dropdown to betray.',
    check: betraysInThen,
    hint: (layout) => {
      if (pdThen(layout).some((b) => play(b, 'C'))) return 'Set it to betray, so a betrayal gets a betrayal back.'
      const body = pdBody(layout)
      const at = body.findIndex(isIf)
      if (at !== -1 && body.slice(at + 1).some((b) => play(b, 'D'))) return 'Put it inside the "then" gap, so it only plays when the opponent betrayed.'
      return null
    },
  },
  {
    id: 'pd-python',
    title: 'Read your Python',
    text: 'Look at the Python. opp_history[-1] == "D" means "the opponent\'s last move was betray", and return "D" plays betray. The last line, return "C", is your fallback: it plays whenever nothing above decided, including the first turn.',
    read: true,
    highlight: [{ kind: 'tour', target: 'python' }],
    general: 'Press Next when you have read this.',
    check: readStep('pd-python'),
  },
  {
    id: 'pd-forgive',
    title: 'Make it forgiving',
    text: 'Two Tit for Tats can feud forever. Open Chance, drag "10 % chance" onto the canvas, put it in a new "if … then" with "play cooperate" inside, and place that above "play betray".',
    highlight: [{ kind: 'category', id: CATEGORY.chance.id }, { kind: 'input', type: 'ic_if', input: 'DO0' }],
    general: 'Build "if 10 % chance then play cooperate" and drop it inside the "then" gap, above "play betray".',
    check: (layout) => {
      const { inner, betrayAfter } = forgiving(layout)
      if (!inner) return false
      const pct = percent(inner.inputs?.IF0?.block)
      return pct >= 1 && pct <= 50 && chain(inner.inputs?.DO0?.block).some((b) => play(b, 'C')) && betrayAfter
    },
    hint: (layout) => {
      const { inner, betrayAfter } = forgiving(layout)
      if (inner && percent(inner.inputs?.IF0?.block) > 50) return 'That forgives most betrayals. Try something like 10.'
      if (inner && !betrayAfter) return 'Move it above "play betray". Blocks under a play block never run.'
      return null
    },
  },
  {
    id: 'pd-send',
    title: 'Send it',
    text: 'No problems, so you\'re ready. Press "Submit strategy". The server tests your bot against sample bots and shows the results in Latest version.',
    submit: true,
    highlight: [{ kind: 'tour', target: 'submit' }],
    general: 'Press "Submit strategy" on the right.',
    check: submitStep('pd-send'),
  },
]

// ---- Round 3: build Grudger with a fair send-back ----

const faRoot = (layout: Layout) => strategyBlock(layout, 'fa_strategy')
const faSend = (layout: Layout) => statements(faRoot(layout), 'SEND')
const faReceive = (layout: Layout) => statements(faRoot(layout), 'RECEIVE')
const faIf = (layout: Layout) => firstIf(faSend(layout))
const faThen = (layout: Layout) => statements(faIf(layout), 'DO0')
const OPPONENT_VALUES = new Set(['fa_opp_sent_last', 'fa_opp_returned_last', 'fa_opp_avg'])

/** The two Opponent blocks that read alike, by the words that tell them apart. */
const LOOK_ALIKE: Record<string, string> = { fa_opp_sent_last: 'gave me last', fa_opp_returned_last: 'returned last' }

/** When a slot holds the other one of the two look-alike blocks, says which one it is and which one the step needs. */
export function lookAlikeHint(found: unknown, needed: string): string | null {
  return typeof found === 'string' && found !== needed && LOOK_ALIKE[found] && LOOK_ALIKE[needed]
    ? `That's "${LOOK_ALIKE[found]}". This step needs "${LOOK_ALIKE[needed]}".`
    : null
}

const ROUND_3: TutorialStep[] = [
  {
    id: 'fa-roles',
    title: 'Two jobs, taking turns',
    text: "In Foreign Aid you take turns. When you're sending, you choose 0 to 10 to send, and it arrives tripled. When you're receiving, you choose how much of that to send back. Your strategy has a section for each. Whatever number you build, the game's limits are kept for you.",
    read: true,
    highlight: [
      { kind: 'input', type: 'fa_strategy', input: 'SEND' },
      { kind: 'input', type: 'fa_strategy', input: 'RECEIVE' },
    ],
    general: 'Press Next when you have read this.',
    check: readStep('fa-roles'),
  },
  {
    id: 'fa-trust',
    title: 'Start by trusting',
    text: 'At the bottom of "when I\'m sending", change "send 5" to "send 10". With nothing else inside, your bot now sends 10 every time.',
    highlight: [{ kind: 'field', type: 'fa_strategy', field: 'SEND_DEFAULT' }],
    general: 'Click the 5 after "if nothing above decided, send" and type 10.',
    check: (layout) => Number(faRoot(layout)?.fields?.SEND_DEFAULT) === 10,
    hint: (layout) => {
      const root = faRoot(layout)
      return root && Number(root.fields?.SEND_DEFAULT) !== 10 && Number(root.fields?.RETURN_PCT_DEFAULT) !== 50
        ? 'That\'s the receiving fallback. Change the one under "when I\'m sending".'
        : null
    },
  },
  {
    id: 'fa-if',
    title: 'Add a decision',
    text: 'Open Logic and drag "if … then" into "when I\'m sending".',
    highlight: [{ kind: 'category', id: CATEGORY.logic.id }, { kind: 'input', type: 'fa_strategy', input: 'SEND' }],
    general: 'Drag "if … then" from Logic into the gap under "when I\'m sending".',
    check: (layout) => faIf(layout) !== undefined,
    hint: (layout) => (faReceive(layout).some(isIf) ? 'That\'s the receiving section. Drag it up into "when I\'m sending".' : null),
  },
  {
    id: 'fa-cheated',
    title: 'Remember who cheated you',
    text: 'Open Opponent and drag "the opponent has ever returned less than I sent" into the gap after "if".',
    highlight: [{ kind: 'category', id: CATEGORY.opponent.id }, { kind: 'block', type: 'ic_if' }],
    general: 'Find "the opponent has ever returned less than I sent" in Opponent and drop it after "if".',
    check: (layout) => faIf(layout)?.inputs?.IF0?.block?.type === 'fa_opp_ever_short',
    hint: (layout) => {
      const condition = faIf(layout)?.inputs?.IF0?.block
      return condition && condition.type !== 'fa_opp_ever_short' ? 'Close, but this step needs "has ever returned less than I sent".' : null
    },
  },
  {
    id: 'fa-stop',
    title: 'Stop trusting them',
    text: 'Open Actions and drag "send" into the "then" gap. Change its number to 0. That\'s Grudger: trust fully until you\'re cheated once.',
    highlight: [{ kind: 'category', id: CATEGORY.actions.id }, { kind: 'block', type: 'ic_if' }],
    general: 'Drag "send" from Actions into the "then" gap, then click its number and type 0.',
    check: (layout) =>
      faThen(layout).some((b) => {
        const amount = slotValue(b.inputs?.AMOUNT)
        return b.type === 'fa_send' && amount?.type === 'fa_number' && Number(amount.fields?.NUM) === 0
      }),
    hint: (layout) => {
      const then = faThen(layout)
      if (then.some((b) => b.type === 'fa_return' || b.type === 'fa_return_pct')) return 'When sending, use "send". "Send back" is for the receiving section.'
      if (then.some((b) => b.type === 'fa_send')) return 'Set the number to 0, so a cheater gets nothing.'
      return null
    },
  },
  {
    id: 'fa-fair',
    title: 'Be fair when receiving',
    text: 'Now "when I\'m receiving". From Actions, drag "send back" into it. Then, from Opponent, drop "what the opponent gave me last" over its number. Sending back what they gave means they never lose by trusting you, and you keep the rest.',
    highlight: [
      { kind: 'input', type: 'fa_strategy', input: 'RECEIVE' },
      { kind: 'category', id: CATEGORY.actions.id },
      { kind: 'category', id: CATEGORY.opponent.id },
    ],
    general: 'Build "send back (what the opponent gave me last)" under "when I\'m receiving".',
    check: (layout) =>
      looseTop(layout, 'fa_strategy').length === 0 &&
      faReceive(layout).some(
        (b) => (b.type === 'fa_return' && slotValue(b.inputs?.AMOUNT)?.type === 'fa_opp_sent_last') || (b.type === 'fa_return_pct' && percent(b) >= 34),
      ),
    hint: (layout) => {
      const receive = faReceive(layout)
      if (receive.some((b) => b.type === 'fa_send')) return FA_MISPLACED.sendInReceive
      const back = receive.find((b) => b.type === 'fa_return')
      const amount = slotValue(back?.inputs?.AMOUNT)
      const lookAlike = lookAlikeHint(amount?.type, 'fa_opp_sent_last')
      if (back && lookAlike) return lookAlike
      if (back && amount && amount.type !== 'fa_opp_sent_last' && (amount.type === 'fa_number' || OPPONENT_VALUES.has(String(amount.type))))
        return 'Drop "what the opponent gave me last" right on top of the number to swap it in.'
      if (looseTop(layout, 'fa_strategy').length > 0) return 'A block is outside your strategy. Delete it (drag it to the bin) or put it inside.'
      return null
    },
  },
  {
    id: 'fa-send',
    title: 'Send it',
    text: 'Every amount goes through legal_send or legal_return, so your bot can never break the rules. No problems, so you\'re ready: press "Submit strategy". The server tests your bot against sample bots and shows the results in Latest version.',
    submit: true,
    highlight: [{ kind: 'tour', target: 'python' }, { kind: 'tour', target: 'submit' }],
    general: 'Press "Submit strategy" on the right.',
    check: submitStep('fa-send'),
  },
]

export const TUTORIALS: Record<TutorialGame, TutorialStep[]> = { prisoners_dilemma: ROUND_1, foreign_aid: ROUND_3 }

export type TutorialProgress = { index: number; step: TutorialStep; hint: string | null; finished: boolean }

/**
 * The first step whose check isn't met, with a targeted hint if the layout shows a common near-miss.
 * `finished` once every step passes.
 */
export function tutorialProgress(game: TutorialGame, layout: Layout, events: TutorialEvents): TutorialProgress {
  const steps = TUTORIALS[game]
  const index = steps.findIndex((step) => !step.check(layout, events))
  if (index === -1) return { index: steps.length - 1, step: steps[steps.length - 1], hint: null, finished: true }
  const step = steps[index]
  return { index, step, hint: step.hint?.(layout) ?? null, finished: false }
}

// ---- remembered per browser ----

export type TutorialState = 'done' | 'skipped'
export const tutorialKey = (game: TutorialGame) => `dz.tutorial.${game}`
/** The open tutorial's place, kept for this browser tab, so a reload resumes it and keeps the team's own blocks. */
export const sessionKey = (game: TutorialGame) => `dz.tutorial.session.${game}`

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const store = (kind: 'local' | 'session'): KeyValueStore | null => {
  try {
    return kind === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

export function readTutorialState(game: TutorialGame, s: KeyValueStore | null = store('local')): TutorialState | null {
  try {
    const value = s?.getItem(tutorialKey(game))
    return value === 'done' || value === 'skipped' ? value : null
  } catch {
    return null
  }
}

export function writeTutorialState(game: TutorialGame, state: TutorialState, s: KeyValueStore | null = store('local')): void {
  try {
    s?.setItem(tutorialKey(game), state)
  } catch {
    // If storage fails, the tutorial still runs; it may just offer itself again
  }
}

/** An open tutorial: the reading steps passed, and the team's blocks from before a replay, if any. */
export type TutorialSession = { read: string[]; saved: Layout | null; startVersion: number | null }

export function readSession(game: TutorialGame, s: KeyValueStore | null = store('session')): TutorialSession | null {
  try {
    const raw = s?.getItem(sessionKey(game))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<TutorialSession>
    if (!Array.isArray(value.read) || !value.read.every((id) => typeof id === 'string')) return null
    const saved = value.saved && typeof value.saved === 'object' ? (value.saved as Layout) : null
    const startVersion = typeof value.startVersion === 'number' ? value.startVersion : null
    return { read: value.read, saved, startVersion }
  } catch {
    return null
  }
}

export function writeSession(game: TutorialGame, session: TutorialSession | null, s: KeyValueStore | null = store('session')): void {
  try {
    if (session) s?.setItem(sessionKey(game), JSON.stringify(session))
    else s?.removeItem(sessionKey(game))
  } catch {
    // Only resuming after a reload is lost
  }
}

/** Whether the tutorial may start by itself (BLOCKS.md 2.1). The Guided tutorial button skips this. */
export function shouldAutoStartTutorial(opts: {
  game: string
  blocksMode: boolean
  fallen: boolean
  canvasEmpty: boolean
  stored: TutorialState | null
  automated: boolean
  tourSettled: boolean
}): boolean {
  if (!hasTutorial(opts.game) || !opts.blocksMode || opts.fallen) return false
  if (opts.automated || opts.stored !== null || !opts.canvasEmpty) return false
  return opts.tourSettled
}

/** Only the strategy block is on the canvas, with nothing inside it. */
export function canvasEmpty(layout: Layout | null | undefined): boolean {
  if (!layout) return true
  const top = topBlocks(layout)
  if (top.length !== 1) return false
  const root = top[0]
  return Object.values(root.inputs ?? {}).every((slot) => !slot?.block)
}
