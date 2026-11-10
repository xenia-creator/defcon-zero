/**
 * The app tour (frontend/docs/BLOCKS.md part 3): each screen's tour replayed with the Tour button
 * (or "Show me around" on the login screen), Back, Skip and Esc, page clicks blocked, and the
 * per-browser memory. Under automation nothing starts by itself, so every other e2e test sees no
 * tour. Every test also fails if the page throws an uncaught error at any point.
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

const popover = (page: Page) => page.locator('.driver-popover.dz-tour')
const tourButton = (page: Page) => page.getByRole('button', { name: 'Tour', exact: true })
const stored = (page: Page, screen: string) => page.evaluate((key) => localStorage.getItem(key), `dz.tour.v1.${screen}`)

async function login(page: Page, user: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Request Clearance' }).click()
}

/** Claims a nation and waits for the workspace, leaving it on whichever tab it opened with. */
async function claim(page: Page) {
  await page.getByLabel('Nation name').fill('Red Fox Republic')
  await page.getByRole('button', { name: 'India' }).click()
  await page.getByRole('button', { name: 'Lock in' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in' }).click()
}

/** Walks the tour step by step, checking the counter and the highlighted marker, and finishes with Done. */
async function walk(page: Page, targets: string[]) {
  for (const [i, target] of targets.entries()) {
    await expect(popover(page)).toBeVisible()
    await expect(popover(page).locator('.driver-popover-progress-text')).toHaveText(`Step ${i + 1} of ${targets.length}`)
    await expect(page.locator('.driver-active-element')).toHaveAttribute('data-tour', target)
    // Skip tour is on every step, including the last
    await expect(popover(page).getByRole('button', { name: 'Skip tour' })).toBeVisible()
    const last = i === targets.length - 1
    await popover(page).getByRole('button', { name: last ? 'Done' : 'Next' }).click()
  }
  await expect(popover(page)).toHaveCount(0)
}

test.describe('replaying each screen with the Tour button', () => {
  test('login: Show me around walks its 3 steps, then remembers it as done', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('Username')).toBeVisible()
    // Under automation nothing starts by itself
    await page.waitForTimeout(1500)
    await expect(popover(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Show me around' }).click()
    await walk(page, ['login-fields', 'login-submit', 'login-bigboard'])
    expect(await stored(page, 'login')).toBe('done')
  })

  test('claim: the Tour button walks its 3 steps, with no map step', async ({ page }) => {
    await login(page, 'team1')
    await expect(page.getByLabel('Search countries')).toBeVisible()
    await tourButton(page).click()
    await walk(page, ['claim-form', 'claim-list', 'claim-submit'])
    expect(await stored(page, 'claim')).toBe('done')
  })

  test('workspace in Round 1 blocks mode: 6 steps, and Back shows the step before', async ({ page }) => {
    await login(page, 'team1')
    await claim(page)
    await expect(page.locator('.blocklySvg').first()).toBeVisible()
    await tourButton(page).click()
    await expect(popover(page)).toContainText('The round and its countdown')
    await popover(page).getByRole('button', { name: 'Next' }).click()
    await expect(popover(page)).toContainText('Choose how to build')
    await popover(page).getByRole('button', { name: 'Back' }).click()
    await expect(popover(page)).toContainText('The round and its countdown')
    await walk(page, ['topbar-clock', 'play-mode', 'examples', 'python', 'submit', 'results'])
    expect(await stored(page, 'workspace')).toBe('done')
  })

  test('workspace in Round 2: 4 steps, without Start from this or the Python panel', async ({ page }) => {
    await mock(page, 'goto', { index: 2 })
    await login(page, 'team1')
    await claim(page)
    await expect(page.getByRole('tab', { name: '◈ Place troops on the map' })).toBeVisible()
    await tourButton(page).click()
    await walk(page, ['topbar-clock', 'play-mode', 'submit', 'results'])
  })

  test('war map, for an organiser: 4 steps', async ({ page }) => {
    await login(page, 'admin')
    await expect(page.locator('[data-tour="warmap-map"]')).toBeVisible()
    await tourButton(page).click()
    await walk(page, ['warmap-round', 'warmap-map', 'warmap-board', 'warmap-clock'])
    expect(await stored(page, 'warmap')).toBe('done')
  })

  test('Command Console, for an organiser: 5 steps', async ({ page }) => {
    await login(page, 'admin')
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Command Console/ }).click()
    await expect(page.locator('[data-tour="ops-order"]')).toBeVisible()
    await tourButton(page).click()
    await walk(page, ['ops-order', 'ops-controls', 'ops-timer', 'ops-roster', 'ops-unclaimed'])
    expect(await stored(page, 'command')).toBe('done')
  })
})

test.describe('leaving the tour', () => {
  test('Skip tour ends it at any step and is remembered as skipped; Esc skips too', async ({ page }) => {
    await login(page, 'team1')
    await claim(page)
    await expect(page.locator('.blocklySvg').first()).toBeVisible()
    await tourButton(page).click()
    await popover(page).getByRole('button', { name: 'Next' }).click()
    await expect(popover(page).locator('.driver-popover-progress-text')).toHaveText('Step 2 of 6')
    await popover(page).getByRole('button', { name: 'Skip tour' }).click()
    await expect(popover(page)).toHaveCount(0)
    expect(await stored(page, 'workspace')).toBe('skipped')

    // Replay is a deliberate click, so it still runs after a skip; Esc then skips it
    await tourButton(page).click()
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    expect(await stored(page, 'workspace')).toBe('skipped')
  })

  test('skipping before the first slide-in finishes is still remembered, and the Tour button comes back', async ({ page }) => {
    await login(page, 'admin')
    await expect(page.locator('[data-tour="warmap-map"]')).toBeVisible()
    await tourButton(page).click()
    // No wait: driver.js is still animating the first step when Skip is pressed
    await popover(page).getByRole('button', { name: 'Skip tour' }).click()
    await expect(popover(page)).toHaveCount(0)
    expect(await stored(page, 'warmap')).toBe('skipped')
    await expect(tourButton(page)).toBeVisible()
    await tourButton(page).click()
    await expect(popover(page)).toBeVisible()
  })

  test('a click on the page during the tour does nothing: no submission, and the tour stays', async ({ page }) => {
    await login(page, 'team1')
    await claim(page)
    const submit = page.getByRole('button', { name: 'Submit strategy' })
    await expect(submit).toBeEnabled()
    const box = (await submit.boundingBox())!
    await tourButton(page).click()
    await expect(popover(page)).toBeVisible()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(500)
    await expect(popover(page)).toBeVisible()
    expect(await (await mock(page, 'submissions')).json()).toHaveLength(0)
    await page.keyboard.press('Escape')
  })

  test('the tour button is gone while a tour runs, and back when it ends', async ({ page }) => {
    await login(page, 'admin')
    await expect(page.locator('[data-tour="warmap-map"]')).toBeVisible()
    await tourButton(page).click()
    await expect(popover(page)).toBeVisible()
    await expect(tourButton(page)).toHaveCount(0)
    await popover(page).getByRole('button', { name: 'Skip tour' }).click()
    await expect(tourButton(page)).toBeVisible()
  })
})

test.describe('who gets a tour', () => {
  test('a spectator on the Big Board gets no Tour button', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /View Big Board/ }).click()
    await expect(page.locator('[data-tour="warmap-map"]')).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(tourButton(page)).toHaveCount(0)
    await expect(popover(page)).toHaveCount(0)
  })

  test('outside automation it starts by itself the first time, and a second visit shows nothing', async ({ page }) => {
    // Hide the automation flag on the login screen only: the tour may then start by itself, as for a real visitor
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
    await page.goto('/')
    await expect(popover(page)).toBeVisible({ timeout: 8_000 })
    await expect(popover(page).locator('.driver-popover-progress-text')).toHaveText('Step 1 of 3')
    await popover(page).getByRole('button', { name: 'Skip tour' }).click()
    expect(await stored(page, 'login')).toBe('skipped')
    await page.reload()
    await expect(page.getByLabel('Username')).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(popover(page)).toHaveCount(0)
  })
})
