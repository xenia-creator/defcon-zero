/**
 * The tournament's end on the live war map, against the mock: the demo teams play all three rounds
 * (each standing team submits every round, so the scores are real ones), the organiser runs
 * open -> start -> publish through the contract routes (docs/api.md sections 2, 4, 5), and the board
 * then names the winner and runner-up from GET /standings (section 6).
 * Playwright sets navigator.webdriver, so the full-screen winner flash (app-level WinnerFlash) must
 * never render here; the permanent banner is not gated and must show. Fails if the page throws at any point.
 */
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8022'
const mock = (page: Page, path: string, data: unknown = {}) => page.request.post(`${API}/__mock/${path}`, { data })

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

interface Nation {
  team_id: number
  nation_name: string
  territory_code: string
  status: string
  score: number
  rank: number
}

async function call<T>(api: APIRequestContext, method: 'GET' | 'POST', path: string, token?: string, data?: unknown): Promise<T> {
  const res = await api.fetch(`${API}${path}`, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true)
  return (await res.json()) as T
}

const login = async (api: APIRequestContext, username: string) =>
  (await call<{ access_token: string }>(api, 'POST', '/auth/login', undefined, { username, password: 'demo' })).access_token

const DEMO_TEAMS = Array.from({ length: 8 }, (_, i) => `demo0${i + 1}`)

/** All three rounds, as the organiser and the teams would play them, through the contract routes only. */
async function playTournament(api: APIRequestContext) {
  const admin = await login(api, 'admin')
  const teams = await Promise.all(DEMO_TEAMS.map((u) => login(api, u)))
  for (const number of [1, 2, 3]) {
    const { rounds } = await call<{ rounds: { id: number; number: number; status: string }[] }>(api, 'GET', '/rounds', admin)
    const round = rounds.find((r) => r.number === number)!
    if (round.status === 'waiting') await call(api, 'POST', `/admin/rounds/${round.id}/open`, admin, { minutes: 30 })

    // Every team still standing submits; eliminated teams are refused (403), so they are skipped
    const submitted: number[] = []
    for (const token of teams) {
      const me = await call<{ status: string }>(api, 'GET', '/me', token)
      if (me.status !== 'active') continue
      const s = await call<{ id: number }>(api, 'POST', '/submissions', token, {
        round_id: round.id,
        code: 'def strategy(*args):\n    return 0\n',
        blocks: { modules: [] },
      })
      submitted.push(s.id)
    }
    // Only accepted versions play: wait for every check to finish
    await expect
      .poll(async () => {
        const all = await Promise.all(
          teams.map((token) => call<{ submissions: { id: number; status: string }[] }>(api, 'GET', `/submissions?round_id=${round.id}`, token)),
        )
        return all.flatMap((r) => r.submissions).filter((s) => submitted.includes(s.id) && s.status === 'accepted').length
      })
      .toBe(submitted.length)

    await call(api, 'POST', `/admin/rounds/${round.id}/start`, admin)
    await expect.poll(async () => (await call<{ status: string }>(api, 'GET', '/rounds/current')).status, { timeout: 10_000 }).toBe('review')
    await call(api, 'POST', `/admin/rounds/${round.id}/publish`, admin)
  }
  return call<{ round_id: number; round_status: string; nations: Nation[] }>(api, 'GET', '/standings')
}

test.describe('the winner on the war map', () => {
  test('after Round 3 is published: banner above the final standings, no full-screen flash under automation', async ({ page }) => {
    await mock(page, 'demo')
    const standings = await playTournament(page.request)

    // The contract's final state: Round 3 published, only rank 1 and rank 2 still active, real scores
    expect(standings.round_status).toBe('published')
    const active = standings.nations.filter((n) => n.status === 'active')
    expect(active.map((n) => n.rank)).toEqual([1, 2])
    const [winner, runnerUp] = active
    expect(winner.score).toBeGreaterThan(0)
    expect(runnerUp.score).toBeGreaterThan(0)
    expect(winner.score).toBeGreaterThanOrEqual(runnerUp.score)

    await page.goto('/')
    expect(await page.evaluate(() => navigator.webdriver)).toBe(true)
    await page.getByLabel('Username').fill('admin')
    await page.getByLabel('Password').fill('demo')
    await page.getByRole('button', { name: 'Request Clearance' }).click()

    const board = page.getByRole('complementary', { name: 'Leaderboard: Round 3 · Foreign Aid — Final' })
    await expect(board).toBeVisible()
    await expect(board.getByText('Tournament complete')).toBeVisible()

    // The permanent banner, with the right winner and runner-up
    const banner = board.getByTestId('winner-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAccessibleName('Tournament result')
    await expect(banner.getByTestId('winner-banner-winner')).toContainText(winner.nation_name)
    await expect(banner.getByTestId('winner-banner-winner')).toContainText(winner.territory_code)
    await expect(banner.getByTestId('winner-banner-runner-up')).toContainText('Runner-up')
    await expect(banner.getByTestId('winner-banner-runner-up')).toContainText(runnerUp.nation_name)
    await expect(banner.getByTestId('winner-banner-runner-up')).toContainText(runnerUp.territory_code)
    await expect(banner.getByTestId('winner-banner-winner')).not.toContainText(runnerUp.nation_name)

    // Above the final standings: the banner ends before the first row starts
    const firstRow = board.getByLabel(new RegExp(`^Rank 1: ${winner.nation_name} \\(${winner.territory_code}\\)`))
    await expect(firstRow).toBeVisible()
    const bannerBox = (await banner.boundingBox())!
    const rowBox = (await firstRow.boundingBox())!
    expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(rowBox.y)

    // Under webdriver the full-screen flash never renders, not even after the polls settle, and
    // nothing winner-related is stored (the flash uses sessionStorage, and only when it plays)
    await page.waitForTimeout(2_500)
    await expect(page.getByTestId('winner-flash')).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dz.winner')))).toEqual([])
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('dz.winner')))).toEqual([])

    // Not gated by localStorage: still there on the next visit
    await page.reload()
    await expect(page.getByTestId('winner-banner')).toBeVisible()
    await expect(page.getByTestId('winner-flash')).toHaveCount(0)
  })

  test('no banner before the final round is published', async ({ page }) => {
    // Round 1 published, Round 2 open: a populated board, but no tournament result
    await mock(page, 'demo', { publish: true })
    await page.goto('/')
    await page.getByLabel('Username').fill('admin')
    await page.getByLabel('Password').fill('demo')
    await page.getByRole('button', { name: 'Request Clearance' }).click()
    const board = page.getByRole('complementary', { name: /^Leaderboard: Round 1/ })
    await expect(board).toBeVisible()
    await page.waitForTimeout(2_500)
    await expect(page.getByTestId('winner-banner')).toHaveCount(0)
    await expect(page.getByTestId('winner-flash')).toHaveCount(0)
  })
})
