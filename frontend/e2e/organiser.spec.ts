/**
 * The organiser's Command Console against the mock: only the transitions the contract allows
 * (docs/api.md section 4), the confirms, errors by code, and every loading state; and the team
 * roster (section 7): labels, order, search, unclaimed accounts, disqualify and restore. Every
 * test also fails if the page throws an uncaught error at any point.
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

async function openConsole(page: Page) {
  await page.goto('/')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Request Clearance' }).click()
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Command Console/ }).click()
}

const dialog = (page: Page) => page.getByRole('dialog')
const toasts = (page: Page) => page.getByTestId('toasts')
const timer = (page: Page) => page.getByTestId('console-timer').locator('p').first()
/** Buttons in the console itself: toasts are buttons too, and repeat action names. */
const consoleButtons = (page: Page, name: RegExp) => page.locator('button:not([data-testid="toasts"] button)').filter({ hasText: name })
const apiError = (status: number, code: string, message: string) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: { code, message } }) })

async function startRound(page: Page, n: number) {
  await page.getByRole('button', { name: 'Close Window · Start Matches' }).click()
  await expect(dialog(page)).toContainText(`Close submissions and start Round ${n}?`)
  await expect(dialog(page)).toContainText("Teams can't submit after this.")
  await dialog(page).getByRole('button', { name: `Start Round ${n}` }).click()
}

async function publishRound(page: Page, n: number, cut: number) {
  await page.getByRole('button', { name: 'Publish Results' }).click({ timeout: 10_000 })
  await expect(dialog(page)).toContainText(`Publish Round ${n}?`)
  await expect(dialog(page)).toContainText(`Results go public, the top ${cut} advance and everyone else is eliminated.`)
  await dialog(page).getByRole('button', { name: `Publish Round ${n}` }).click()
}

test.describe('round actions', () => {
  test('an open round offers Extend and Start only, and no mock controls in a build', async ({ page }) => {
    await openConsole(page)
    await expect(timer(page)).toHaveText(/^(29:\d\d|30:00)$/)
    await expect(page.getByRole('button', { name: 'Extend window' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close Window · Start Matches' })).toBeVisible()
    await expect(consoleButtons(page, /Re-open|Open Round|Publish|Retry/)).toHaveCount(0)
    await expect(page.getByText('Mock demo')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reset Event' })).toHaveCount(0)
  })

  test('extend checks its minutes and moves the timer', async ({ page }) => {
    await openConsole(page)
    const field = page.getByLabel('Add minutes to the window')
    await expect(field).toHaveValue('10')
    for (const bad of ['0', '241', '4.5', '']) {
      await field.fill(bad)
      await expect(page.getByText('Enter a whole number of minutes from 1 to 240.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Extend window' })).toBeDisabled()
    }
    await field.fill('10')
    await page.getByRole('button', { name: 'Extend window' }).click()
    await expect(timer(page)).toHaveText(/^(39:\d\d|40:00)$/)
  })

  test('a waiting round opens with 45 minutes by default', async ({ page }) => {
    await openConsole(page)
    await mock(page, 'round', { status: 'waiting', closes_in: null })
    await expect(page.getByLabel('Submission window, in minutes')).toHaveValue('45')
    await expect(consoleButtons(page, /Extend|Start|Publish|Retry/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Open Round 1' }).click()
    await expect(timer(page)).toHaveText(/^(44:\d\d|45:00)$/)
  })

  test('the timer uses server time when this laptop’s clock is wrong', async ({ page }) => {
    await page.addInitScript(() => {
      const real = Date.now.bind(Date)
      Date.now = () => real() + 3 * 3600 * 1000
    })
    await openConsole(page)
    await expect(timer(page)).toHaveText(/^(29:\d\d|30:00)$/)
  })

  test('runs all three rounds to "Tournament complete", fields back at their defaults each round', async ({ page }) => {
    await openConsole(page)
    await page.getByLabel('Add minutes to the window').fill('30')
    await startRound(page, 1)
    await expect(page.getByText('Matches playing…')).toBeVisible()
    await publishRound(page, 1, 15)
    await expect(page.getByLabel('Submission window, in minutes')).toHaveValue('45')
    await page.getByRole('button', { name: 'Open Round 2' }).click()
    await expect(timer(page)).toHaveText(/^(44:\d\d|45:00)$/)
    await expect(page.getByLabel('Add minutes to the window')).toHaveValue('10')
    await startRound(page, 2)
    await publishRound(page, 2, 8)
    await page.getByRole('button', { name: 'Open Round 3' }).click()
    await startRound(page, 3)
    await publishRound(page, 3, 2)
    await expect(page.getByText('Tournament complete')).toBeVisible()
    await expect(consoleButtons(page, /Open Round|Publish|Retry|Start|Extend/)).toHaveCount(0)
  })

  test('a failed run stays playing until Retry replays it', async ({ page }) => {
    await openConsole(page)
    await mock(page, 'failrun')
    await startRound(page, 1)
    await expect(page.getByText('Matches playing…')).toBeVisible()
    await page.waitForTimeout(2_500)
    await expect(page.getByText('Matches playing…')).toBeVisible()
    await page.getByRole('button', { name: 'Retry Matches' }).click()
    await expect(dialog(page)).toContainText("Replay all of Round 1's matches from the start? Only use this if the run failed.")
    await dialog(page).getByRole('button', { name: 'Replay matches' }).click()
    await expect(page.getByRole('button', { name: 'Publish Results' })).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('errors, by code', () => {
  test('INVALID_ROUND_TRANSITION explains itself, refetches at once, and stays in the panel until an action succeeds', async ({ page }) => {
    await openConsole(page)
    await page.route('**/admin/rounds/1/start', (r) => r.fulfill(apiError(409, 'INVALID_ROUND_TRANSITION', 'Round 1 is review, not open.')))
    // The overview polls every 2 s, so only a request right after the 409 proves the refetch
    let failedAt = 0
    const overviewAfter: number[] = []
    page.on('response', (r) => {
      if (r.url().endsWith('/admin/rounds/1/start')) failedAt = Date.now()
    })
    page.on('request', (r) => {
      if (failedAt && r.url().endsWith('/admin/overview')) overviewAfter.push(Date.now() - failedAt)
    })
    await startRound(page, 1)
    const message = "That action isn't allowed right now, the round may have changed."
    await expect(toasts(page)).toContainText(message)
    await expect(toasts(page)).not.toContainText('review, not open')
    await expect.poll(() => overviewAfter.length).toBeGreaterThan(0)
    expect(overviewAfter[0]).toBeLessThan(500)

    // Toasts fade; the panel keeps it until a round action works
    await expect(page.getByTestId('round-error')).toHaveText(message)
    await page.getByRole('button', { name: 'Extend window' }).click()
    await expect(page.getByTestId('round-error')).toHaveCount(0)
  })

  test('Retry while the matches still play says so', async ({ page }) => {
    await openConsole(page)
    await startRound(page, 1)
    await page.getByRole('button', { name: 'Retry Matches' }).click()
    await dialog(page).getByRole('button', { name: 'Replay matches' }).click()
    await expect(page.getByTestId('round-error')).toHaveText('Matches are still playing. Retry only works after a failed run.')
  })

  test('VALIDATION_ERROR and anything else show the server message', async ({ page }) => {
    await openConsole(page)
    await page.route('**/admin/rounds/1/extend', (r) => r.fulfill(apiError(400, 'VALIDATION_ERROR', 'minutes must be a whole number from 1 to 240.')))
    await page.getByRole('button', { name: 'Extend window' }).click()
    await expect(page.getByTestId('round-error')).toHaveText('minutes must be a whole number from 1 to 240.')
    await page.unroute('**/admin/rounds/1/extend')
    await page.route('**/admin/rounds/1/extend', (r) => r.fulfill(apiError(500, 'INTERNAL_ERROR', 'Something broke on our side.')))
    await page.getByRole('button', { name: 'Extend window' }).click()
    await expect(page.getByTestId('round-error')).toHaveText('Something broke on our side.')
  })

  test('a button is disabled while its request is in flight, and sends once', async ({ page }) => {
    await openConsole(page)
    let sent = 0
    await page.route('**/admin/rounds/1/extend', async (r) => {
      sent++
      await new Promise((done) => setTimeout(done, 1_500))
      await r.continue()
    })
    const field = page.getByLabel('Add minutes to the window')
    await field.press('Enter')
    await field.press('Enter')
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Close Window · Start Matches' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Extend window' })).toBeEnabled({ timeout: 5_000 })
    expect(sent).toBe(1)
  })
})

test.describe('states', () => {
  test('no rounds at all (404): "No rounds created yet", no buttons', async ({ page }) => {
    await page.route('**/admin/overview', (r) => r.fulfill(apiError(404, 'NOT_FOUND', 'No rounds.')))
    await openConsole(page)
    await expect(page.getByText('No rounds created yet')).toBeVisible()
    await expect(consoleButtons(page, /Extend|Start|Open Round|Publish|Retry/)).toHaveCount(0)
  })

  test('a failed load offers Retry and recovers', async ({ page }) => {
    await mock(page, 'fail', { '/admin/overview': 502 })
    await openConsole(page)
    await expect(page.getByText('Could not load the organiser overview.')).toBeVisible()
    await expect(consoleButtons(page, /Extend|Start/)).toHaveCount(0)
    await mock(page, 'fail', {})
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('button', { name: 'Extend window' })).toBeVisible()
  })

  test('a failed poll keeps the last good data, then clears', async ({ page }) => {
    await openConsole(page)
    await expect(page.getByRole('button', { name: 'Extend window' })).toBeVisible()
    await mock(page, 'fail', { '/admin/overview': 502 })
    await expect(page.getByText('Lost contact with the server.')).toBeVisible({ timeout: 6_000 })
    await expect(page.getByRole('button', { name: 'Extend window' })).toBeVisible()
    await expect(page.getByTestId('console-timer')).toBeVisible()
    await mock(page, 'fail', {})
    await expect(page.getByText('Lost contact with the server.')).toHaveCount(0, { timeout: 6_000 })
  })
})

test.describe('roster', () => {
  const row = (page: Page, username: string) => page.getByTestId('roster-row').filter({ hasText: username })
  const usernames = (page: Page) => page.getByTestId('roster-row').locator('td:nth-child(3)').allInnerTexts()
  /** Changes the real overview on its way to the page. The test runner can't resolve lab.test, so it fetches via localhost. */
  const editOverview = (page: Page, edit: (overview: { teams: Record<string, unknown>[]; unclaimed: string[] }) => void) =>
    page.route('**/admin/overview', async (r) => {
      const response = await r.fetch({ url: r.request().url().replace('lab.test', 'localhost') })
      const json = await response.json()
      edit(json)
      await r.fulfill({ response, json })
    })

  test.beforeEach(async ({ page }) => {
    await mock(page, 'demo')
  })

  test('shows each submission state, never a false "rejected" or "0 / 0"', async ({ page }) => {
    await editOverview(page, ({ teams }) => {
      const at = '2026-11-12T10:20:11Z'
      teams[0].submission = { version: 2, status: 'pending', passed: 0, total: 0, submitted_at: at }
      teams[1].submission = { version: 3, status: 'running', passed: 0, total: 0, submitted_at: at }
      teams[2].submission = { version: 1, status: 'rejected', passed: 0, total: 0, submitted_at: at }
      teams[3].submission = { version: 5, status: 'rejected', passed: 3, total: 9, submitted_at: at }
      teams[4].submission = null
      teams[5].score = 1.333333
    })
    await openConsole(page)
    await expect(row(page, 'demo01')).toContainText('Checking…')
    await expect(row(page, 'demo02')).toContainText('Checking…')
    await expect(row(page, 'demo03')).toContainText(/rejected · v1 · \d\d:\d\d:\d\d/)
    await expect(row(page, 'demo03')).not.toContainText('passed')
    await expect(row(page, 'demo04')).toContainText(/rejected · v5 · passed 3 \/ 9 · \d\d:\d\d:\d\d/)
    await expect(row(page, 'demo05')).toContainText('No submission')
    await expect(row(page, 'demo06')).toContainText('1.33')
    await expect(row(page, 'demo07')).toContainText(/accepted · v1 · passed \d+ \/ \d+ · \d\d:\d\d:\d\d/)
    await expect(page.getByTestId('roster-row').filter({ hasText: '0 / 0' })).toHaveCount(0)
  })

  test('server order while open; by score in review, disqualified at the bottom', async ({ page }) => {
    await openConsole(page)
    await expect(page.getByTestId('roster-order')).toHaveText('Sorted by username')
    expect(await usernames(page)).toEqual(['demo01', 'demo02', 'demo03', 'demo04', 'demo05', 'demo06', 'demo07', 'demo08'])
    await mock(page, 'team', { username: 'demo01', change: { status: 'disqualified' } })
    await expect(page.getByTestId('roster-row').last()).toContainText('demo01')

    await startRound(page, 1)
    await expect(page.getByRole('button', { name: 'Publish Results' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('roster-order')).toHaveText('Sorted by score')
    await expect(page.getByTestId('roster-order')).not.toContainText(/rank/i)
    const rows = page.getByTestId('roster-row')
    const scores = (await rows.locator('td:nth-child(6)').allInnerTexts()).slice(0, -1).map(Number)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    await expect(rows.last()).toContainText('demo01')
  })

  test('search by nation or username, filter by status, with a count', async ({ page }) => {
    await mock(page, 'team', { username: 'demo02', change: { status: 'eliminated' } })
    await mock(page, 'team', { username: 'demo03', change: { status: 'disqualified' } })
    await openConsole(page)
    const count = page.getByTestId('roster-count')
    await expect(count).toHaveText('8 teams')
    await page.getByLabel('Search teams').fill('red dawn')
    expect(await usernames(page)).toEqual(['demo01'])
    await expect(count).toHaveText('1 of 8 teams')
    await page.getByLabel('Search teams').fill('DEMO04')
    expect(await usernames(page)).toEqual(['demo04'])
    await page.getByLabel('Search teams').fill('')
    await page.getByLabel('Status filter').selectOption('eliminated')
    expect(await usernames(page)).toEqual(['demo02'])
    await page.getByLabel('Status filter').selectOption('disqualified')
    expect(await usernames(page)).toEqual(['demo03'])
    await page.getByLabel('Status filter').selectOption('active')
    await expect(count).toHaveText('6 of 8 teams')
    await page.getByLabel('Search teams').fill('zzz')
    await expect(page.getByText('No teams match.')).toBeVisible()
  })

  test('unclaimed accounts: count and list, or "All accounts claimed"', async ({ page }) => {
    await openConsole(page)
    const panel = page.getByTestId('unclaimed')
    await expect(panel).toContainText('4 accounts not claimed')
    await expect(panel.getByRole('listitem')).toHaveText(['demo09', 'demo10', 'team1', 'team2'])
    await expect(panel.getByRole('button')).toHaveCount(0)
    await editOverview(page, (overview) => {
      overview.unclaimed = []
    })
    await expect(panel).toHaveText('All accounts claimed', { timeout: 5_000 })
    await expect(panel.getByRole('list')).toHaveCount(0)
  })

  test('each status gets its button, and each confirm says what happens in this round', async ({ page }) => {
    await mock(page, 'team', { username: 'demo02', change: { status: 'eliminated' } })
    await openConsole(page)
    await expect(row(page, 'demo01').getByRole('button')).toHaveText('Disqualify')
    await expect(row(page, 'demo02').getByRole('button')).toHaveCount(0)

    // open
    await row(page, 'demo01').getByRole('button', { name: 'Disqualify' }).click()
    await expect(dialog(page)).toContainText("Disqualify Red Dawn? They can't submit any more.")
    await dialog(page).getByRole('button', { name: 'Disqualify' }).click()
    await expect(row(page, 'demo01').getByRole('button')).toHaveText('Restore')
    await row(page, 'demo01').getByRole('button', { name: 'Restore' }).click()
    await expect(dialog(page)).toContainText('Restore Red Dawn? They become active again.')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    // review
    await startRound(page, 1)
    await expect(page.getByRole('button', { name: 'Publish Results' })).toBeVisible({ timeout: 10_000 })
    await row(page, 'demo03').getByRole('button', { name: 'Disqualify' }).click()
    await expect(dialog(page)).toContainText('Disqualify Monsoon Union? They drop to the bottom of this round and the next team moves into the cut.')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await row(page, 'demo01').getByRole('button', { name: 'Restore' }).click()
    await expect(dialog(page)).toContainText('Restore Red Dawn? The round is re-ranked and they get back the place they earned.')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    // published
    await publishRound(page, 1, 15)
    await expect(page.getByRole('button', { name: 'Open Round 2' })).toBeVisible()
    await row(page, 'demo03').getByRole('button', { name: 'Disqualify' }).click()
    await expect(dialog(page).getByText('Disqualify Monsoon Union?', { exact: true })).toBeVisible()
    await expect(dialog(page)).not.toContainText('drop to the bottom')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await row(page, 'demo01').getByRole('button', { name: 'Restore' }).click()
    await expect(dialog(page)).toContainText("Restore Red Dawn? This round's cut is already applied, so restoring makes them active for the next round.")
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  test('a row error by code stays in its row, refetches at once, and clears on that row’s next success', async ({ page }) => {
    await openConsole(page)
    await page.route('**/admin/teams/*', (r) => r.fulfill(apiError(404, 'NOT_FOUND', 'This team does not exist.')))
    let failedAt = 0
    const overviewAfter: number[] = []
    page.on('response', (r) => {
      if (r.url().includes('/admin/teams/')) failedAt = Date.now()
    })
    page.on('request', (r) => {
      if (failedAt && r.url().endsWith('/admin/overview')) overviewAfter.push(Date.now() - failedAt)
    })
    await row(page, 'demo01').getByRole('button', { name: 'Disqualify' }).click()
    await dialog(page).getByRole('button', { name: 'Disqualify' }).click()
    await expect(page.getByTestId('row-error')).toHaveText('Red Dawn: Team no longer exists, refresh')
    await expect(toasts(page)).toContainText('Red Dawn: Team no longer exists, refresh')
    await expect(toasts(page)).not.toContainText('This team does not exist.')
    await expect.poll(() => overviewAfter.length).toBeGreaterThan(0)
    expect(overviewAfter[0]).toBeLessThan(500)

    await page.unroute('**/admin/teams/*')
    await page.route('**/admin/teams/*', (r) => r.fulfill(apiError(403, 'FORBIDDEN', 'Organisers only.')))
    await row(page, 'demo02').getByRole('button', { name: 'Disqualify' }).click()
    await dialog(page).getByRole('button', { name: 'Disqualify' }).click()
    await expect(page.getByTestId('row-error').filter({ hasText: 'Amazon Pact' })).toHaveText('Amazon Pact: Not an organiser')
    await expect(page.getByTestId('row-error')).toHaveCount(2)

    await page.unroute('**/admin/teams/*')
    await row(page, 'demo01').getByRole('button', { name: 'Disqualify' }).click()
    await dialog(page).getByRole('button', { name: 'Disqualify' }).click()
    await expect(row(page, 'demo01').getByRole('button')).toHaveText('Restore')
    await expect(page.getByTestId('row-error')).toHaveCount(1)
    await expect(page.getByTestId('row-error')).toContainText('Amazon Pact')
  })

  test('only that row is busy while its request runs, and it sends once', async ({ page }) => {
    await openConsole(page)
    let sent = 0
    await page.route('**/admin/teams/*', async (r) => {
      sent++
      await new Promise((done) => setTimeout(done, 1_500))
      await r.continue()
    })
    await row(page, 'demo01').getByRole('button', { name: 'Disqualify' }).click()
    await dialog(page).getByRole('button', { name: 'Disqualify' }).click()
    const busy = row(page, 'demo01').getByRole('button', { name: 'Sending…' })
    await expect(busy).toBeDisabled()
    await busy.click({ force: true }).catch(() => {})
    await expect(row(page, 'demo02').getByRole('button', { name: 'Disqualify' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Extend window' })).toBeEnabled()
    await expect(row(page, 'demo01').getByRole('button', { name: 'Restore' })).toBeVisible({ timeout: 5_000 })
    expect(sent).toBe(1)
  })
})
