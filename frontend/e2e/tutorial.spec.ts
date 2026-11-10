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
