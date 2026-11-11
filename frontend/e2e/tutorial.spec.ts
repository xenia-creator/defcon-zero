/**
 * The guided blocks tutorial (frontend/docs/BLOCKS.md part 2), driven as BLOCKS.md 2.4 says: start it
 * with the Guided tutorial button, then load each step's layout (the tutorial keeps its place in the
 * tab, so a reload resumes it). Under automation it never starts by itself. Every test also fails if
 * the page throws an uncaught error at any point.
 */
import { expect, test as base, type Page } from '@playwright/test'

const mock = (page: Page, path: string, data: unknown = {}) => page.request.post(`http://localhost:8022/__mock/${path}`, { data })

const test = base.extend<{ crashes: string[] }>({
  crashes: [
    async ({ page }, use) => {
      const crashes: string[] = []
      page.on('pageerror', (e) => crashes.push(e.message))
      await mock(page, 'reset')
      await use(crashes)
      expect(crashes).toEqual([])
    },
    { auto: true },
  ],
})

const card = (page: Page) => page.getByTestId('tutorial-card')
const python = (page: Page) => page.getByTestId('strategy-python')
const guided = (page: Page) => page.getByRole('button', { name: 'Guided tutorial' })
const stored = (page: Page, game: string) => page.evaluate((key) => localStorage.getItem(key), `dz.tutorial.${game}`)

/** A new team in Build with blocks, in the given round. */
async function blocksWorkspace(page: Page, round = 1) {
  if (round > 1) await mock(page, 'goto', { index: round })
  await page.goto('/')
  await page.getByLabel('Username').fill('team1')
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Request Clearance' }).click()
  await page.getByLabel('Nation name').fill('Red Fox Republic')
  await page.getByRole('button', { name: 'India' }).click()
  await page.getByRole('button', { name: 'Lock in' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in' }).click()
  await expect(page.getByRole('tab', { name: '▦ Build with blocks' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.blocklySvg').first()).toBeVisible()
}

/** Puts a canvas into the saved draft and reloads; the open tutorial resumes on it. */
async function loadCanvas(page: Page, game: string, layout: object) {
  await page.evaluate(
    ([key, strategy]) =>
      localStorage.setItem(
        key as string,
        JSON.stringify({ saved_at: Date.now() + 100000, agent: { hand_code: 'def strategy(my_history, opp_history):\n    return "C"\n', modules: [], strategy_blocks: strategy, mode: 'blocks' } }),
      ),
    [`draft:1:${game}`, layout],
  )
  await page.reload()
  await expect(page.locator('.blocklySvg').first()).toBeVisible()
}

const expectStep = async (page: Page, n: number, title: string) => {
  await expect(card(page)).toContainText(`Step ${n} of 7`)
  await expect(card(page)).toContainText(title)
}

// ---- Round 1 layouts ----
const play = (MOVE: string) => ({ type: 'ic_play', fields: { MOVE } })
const ifThen = (condition?: object, then?: object) => ({ type: 'ic_if', inputs: { ...(condition ? { IF0: { block: condition } } : {}), ...(then ? { DO0: { block: then } } : {}) } })
const pd = (body?: object) => ({ blocks: { languageVersion: 0, blocks: [{ type: 'ic_strategy', x: 24, y: 24, deletable: false, fields: { FALLBACK: 'C' }, ...(body ? { inputs: { BODY: { block: body } } } : {}) }] } })
const oppLast = (MOVE: string) => ({ type: 'ic_opp_last', fields: { MOVE } })

// ---- Round 3 layouts ----
const shadow = (NUM: number) => ({ shadow: { type: 'fa_number', fields: { NUM } } })
const fa = (o: { sd?: number; send?: object; receive?: object } = {}) => ({
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'fa_strategy',
        x: 24,
        y: 24,
        deletable: false,
        fields: { SEND_DEFAULT: o.sd ?? 5, RETURN_PCT_DEFAULT: 50 },
        inputs: { ...(o.send ? { SEND: { block: o.send } } : {}), ...(o.receive ? { RECEIVE: { block: o.receive } } : {}) },
      },
    ],
  },
})
const short = { type: 'fa_opp_ever_short' }
const sendZero = { type: 'fa_send', inputs: { AMOUNT: shadow(0) } }

test('nothing starts by itself under automation, and the tutorial is offered only in Build with blocks', async ({ page }) => {
  await blocksWorkspace(page)
  await page.waitForTimeout(2000)
  await expect(card(page)).toHaveCount(0)
  await expect(guided(page)).toBeVisible()
  await page.getByRole('tab', { name: '</> Write code' }).click()
  await expect(guided(page)).toHaveCount(0)
})

test('Round 2 has no tutorial', async ({ page }) => {
  await mock(page, 'goto', { index: 2 })
  await page.goto('/')
  await page.getByLabel('Username').fill('team1')
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Request Clearance' }).click()
  await page.getByLabel('Nation name').fill('Red Fox Republic')
  await page.getByRole('button', { name: 'India' }).click()
  await page.getByRole('button', { name: 'Lock in' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in' }).click()
  await expect(page.getByRole('tab', { name: '◈ Place troops on the map' })).toBeVisible()
  await expect(guided(page)).toHaveCount(0)
})

test('Round 1: started with the button, it walks all 7 steps to Forgiving Tit for Tat and ends on Keep this', async ({ page }) => {
  await blocksWorkspace(page)
  await guided(page).click()
  await expectStep(page, 1, 'Meet your strategy')
  await expect(card(page)).toHaveAttribute('aria-modal', 'false')
  await expect(page.getByTestId('tutorial-highlight').first()).toBeVisible()
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expectStep(page, 2, 'Add a decision')

  await loadCanvas(page, 'prisoners_dilemma', pd(ifThen()))
  await expectStep(page, 3, 'What are you reacting to?')
  // A near-miss gets its targeted hint straight away
  await loadCanvas(page, 'prisoners_dilemma', pd(ifThen(oppLast('C'))))
  await expect(card(page)).toContainText('Almost: set the dropdown to betrayed.')
  await loadCanvas(page, 'prisoners_dilemma', pd(ifThen(oppLast('D'))))
  await expectStep(page, 4, 'Hit back')
  await loadCanvas(page, 'prisoners_dilemma', pd(ifThen(oppLast('D'), play('D'))))
  await expectStep(page, 5, 'Read your Python')
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expectStep(page, 6, 'Make it forgiving')
  await loadCanvas(page, 'prisoners_dilemma', pd(ifThen(oppLast('D'), { ...ifThen({ type: 'ic_chance', fields: { PERCENT: 10 } }, play('C')), next: { block: play('D') } })))
  await expectStep(page, 7, 'Send it')
  await expect(python(page)).toContainText('if random.random() < 0.1:')

  // It never submits for the team: the team presses Submit
  expect(await (await mock(page, 'submissions')).json()).toHaveLength(0)
  await page.getByRole('button', { name: 'Submit strategy' }).click()
  await expect(card(page)).toContainText('Tutorial done')
  await expect(card(page)).toContainText('ties are a coin toss')
  await expect(card(page).getByRole('button', { name: 'Put my blocks back' })).toHaveCount(0)
  await card(page).getByRole('button', { name: 'Keep this' }).click()
  await expect(card(page)).toHaveCount(0)
  expect(await stored(page, 'prisoners_dilemma')).toBe('done')
  await expect(python(page)).toContainText('if random.random() < 0.1:')
})

test('Round 3: it walks all 7 steps to Grudger with a fair send-back, and the closed window offers Finish', async ({ page }) => {
  await blocksWorkspace(page, 3)
  await guided(page).click()
  await expectStep(page, 1, 'Two jobs, taking turns')
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expectStep(page, 2, 'Start by trusting')

  await loadCanvas(page, 'foreign_aid', fa({ sd: 10 }))
  await expectStep(page, 3, 'Add a decision')
  await loadCanvas(page, 'foreign_aid', fa({ sd: 10, send: ifThen() }))
  await expectStep(page, 4, 'Remember who cheated you')
  await loadCanvas(page, 'foreign_aid', fa({ sd: 10, send: ifThen(short) }))
  await expectStep(page, 5, 'Stop trusting them')
  await loadCanvas(page, 'foreign_aid', fa({ sd: 10, send: ifThen(short, sendZero) }))
  await expectStep(page, 6, 'Be fair when receiving')
  // "what the opponent sent last" dropped on the shadow 5: it replaces it, with nothing loose
  await loadCanvas(page, 'foreign_aid', fa({ sd: 10, send: ifThen(short, sendZero), receive: { type: 'fa_return', inputs: { AMOUNT: { block: { type: 'fa_opp_sent_last' }, ...shadow(5) } } } }))
  await expectStep(page, 7, 'Send it')
  await expect(python(page)).toContainText('return legal_return((opp_sent[-1] if opp_sent else 0), received)')

  // With the window closed, the last step says so and finishes without submitting
  await mock(page, 'round', { status: 'running' })
  await expect(card(page)).toContainText("Submit opens when the round's submission window does.")
  await card(page).getByRole('button', { name: 'Finish' }).click()
  await expect(card(page)).toContainText('Tutorial done')
  await card(page).getByRole('button', { name: 'Keep this' }).click()
  expect(await stored(page, 'foreign_aid')).toBe('done')
  expect(await (await mock(page, 'submissions')).json()).toHaveLength(0)
})

test('replaying over existing work asks first, and Skip puts the team’s blocks back', async ({ page }) => {
  await blocksWorkspace(page)
  await page.getByRole('button', { name: 'Start from this' }).click()
  await page.getByRole('region', { name: 'Start from this' }).getByRole('button', { name: /^Grudger/ }).click()
  await expect(python(page)).toContainText('"D" in opp_history')

  await guided(page).click()
  await expect(page.getByRole('dialog').filter({ hasText: 'Your blocks are kept' })).toBeVisible()
  await page.getByRole('button', { name: 'Start tutorial' }).click()
  await expectStep(page, 1, 'Meet your strategy')
  await expect(python(page)).not.toContainText('"D" in opp_history')

  await card(page).getByRole('button', { name: 'Skip tutorial' }).click()
  await expect(card(page)).toHaveCount(0)
  await expect(python(page)).toContainText('"D" in opp_history')
  expect(await stored(page, 'prisoners_dilemma')).toBe('skipped')
})

test('Esc skips only while focus is in the card, never from the canvas', async ({ page }) => {
  await blocksWorkspace(page)
  await guided(page).click()
  await expect(card(page)).toBeVisible()
  await page.locator('.blocklySvg').first().click({ position: { x: 600, y: 500 } })
  await page.keyboard.press('Escape')
  await expect(card(page)).toBeVisible()
  await card(page).getByRole('button', { name: 'Skip tutorial' }).focus()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  expect(await stored(page, 'prisoners_dilemma')).toBe('skipped')
})

test('a deleted block sends the tutorial back to its step, with Back re-showing earlier text', async ({ page }) => {
  await blocksWorkspace(page)
  await guided(page).click()
  await card(page).getByRole('button', { name: 'Next' }).click()
  await loadCanvas(page, 'prisoners_dilemma', pd(ifThen(oppLast('D'))))
  await expectStep(page, 4, 'Hit back')
  await card(page).getByRole('button', { name: 'Back' }).click()
  await expect(card(page)).toContainText('Step 3 of 7')
  await loadCanvas(page, 'prisoners_dilemma', pd())
  await expectStep(page, 2, 'Add a decision')
})

// ---- the movable card ----
const handle = (page: Page) => page.getByTestId('tutorial-card-handle')
const cardBox = async (page: Page) => (await card(page).boundingBox())!
/** The card's container: the canvas with its Python strip. */
const canvasBox = async (page: Page) => (await card(page).locator('xpath=..').boundingBox())!
const expectInside = async (page: Page) => {
  const [c, a] = [await cardBox(page), await canvasBox(page)]
  expect(c.x).toBeGreaterThanOrEqual(a.x - 1)
  expect(c.y).toBeGreaterThanOrEqual(a.y - 1)
  expect(c.x + c.width).toBeLessThanOrEqual(a.x + a.width + 1)
  expect(c.y + c.height).toBeLessThanOrEqual(a.y + a.height + 1)
}
const expectDocked = async (page: Page) => {
  const [c, a] = [await cardBox(page), await canvasBox(page)]
  expect(Math.abs(a.x + a.width - (c.x + c.width) - 12)).toBeLessThanOrEqual(1)
  expect(Math.abs(c.y - a.y - 12)).toBeLessThanOrEqual(1)
}
/** Drags the card by its title line, away from the header's buttons. */
async function dragCard(page: Page, dx: number, dy: number) {
  const h = (await handle(page).boundingBox())!
  const from = { x: h.x + 30, y: h.y + h.height - 8 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 })
  await page.mouse.up()
}
/** Where the canvas is scrolled and where the strategy block sits: a drag on the card must change neither. */
const canvasState = (page: Page) =>
  Promise.all([page.locator('.blocklyBlockCanvas').first().getAttribute('transform'), page.locator('.blocklyBlockCanvas > g').first().getAttribute('transform')])

test('the card drags by its header, stays inside the canvas, still works after, and Dock puts it back', async ({ page }) => {
  await blocksWorkspace(page)
  await guided(page).click()
  await expectStep(page, 1, 'Meet your strategy')
  await expectDocked(page)
  const before = await cardBox(page)
  const canvasBefore = await canvasState(page)

  await dragCard(page, -400, 120)
  const after = await cardBox(page)
  expect(after.x).toBeLessThan(before.x - 350)
  expect(after.y).toBeGreaterThan(before.y + 80)
  await expectInside(page)
  // Blockly never saw the drag: the canvas didn't pan and no block moved
  expect(await canvasState(page)).toEqual(canvasBefore)

  // Dragged far past the corner, it stops at the canvas's edge
  await dragCard(page, -3000, 3000)
  await expectInside(page)
  const corner = [await cardBox(page), await canvasBox(page)]
  expect(Math.abs(corner[0].x - corner[1].x)).toBeLessThanOrEqual(1)
  expect(Math.abs(corner[0].y + corner[0].height - (corner[1].y + corner[1].height))).toBeLessThanOrEqual(1)

  // Its buttons still click, and it stays where it was put, also after a reload in this tab
  const moved = await cardBox(page)
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expectStep(page, 2, 'Add a decision')
  expect((await cardBox(page)).x).toBeCloseTo(moved.x, 0)
  await page.reload()
  await expectStep(page, 2, 'Add a decision')
  expect((await cardBox(page)).x).toBeCloseTo(moved.x, 0)

  await card(page).getByRole('button', { name: 'Dock' }).click()
  await expectDocked(page)
  await expect(card(page).getByRole('button', { name: 'Dock' })).toHaveCount(0)
})

test('Minimise folds the card to its header, the header moves by keyboard, and a new tutorial starts docked', async ({ page }) => {
  await blocksWorkspace(page)
  await guided(page).click()
  await expectStep(page, 1, 'Meet your strategy')

  const full = await cardBox(page)
  await card(page).getByRole('button', { name: 'Minimise' }).click()
  await expect(card(page).getByRole('button', { name: 'Skip tutorial' })).toHaveCount(0)
  await expect(card(page)).toContainText('Step 1 of 7')
  expect((await cardBox(page)).height).toBeLessThan(full.height / 2)
  await card(page).getByRole('button', { name: 'Expand' }).click()
  await expect(card(page).getByRole('button', { name: 'Skip tutorial' })).toBeVisible()

  // Arrow keys move it 16px with the header focused; Home docks it
  await handle(page).focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowDown')
  const nudged = await cardBox(page)
  expect(Math.round(full.x - nudged.x)).toBe(32)
  expect(Math.round(nudged.y - full.y)).toBe(16)
  await page.keyboard.press('Home')
  await expectDocked(page)

  // Moved, then ended: the next tutorial starts docked and expanded
  await dragCard(page, -300, 60)
  await card(page).getByRole('button', { name: 'Minimise' }).click()
  await card(page).getByRole('button', { name: 'Expand' }).focus()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  expect(await stored(page, 'prisoners_dilemma')).toBe('skipped')
  await guided(page).click()
  await expectStep(page, 1, 'Meet your strategy')
  await expectDocked(page)
  await expect(card(page).getByRole('button', { name: 'Skip tutorial' })).toBeVisible()
})
