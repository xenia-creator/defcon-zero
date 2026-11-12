/**
 * Tries to break the team screens the way a real event can: bad saved data, a
 * failing or vanishing server, double clicks, races. Every test also fails if
 * the page throws an uncaught error at any point.
 */
import { expect, test as base, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

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

async function login(page: Page, user = 'team1') {
  await page.goto('/')
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Request Clearance' }).click()
}

async function claim(page: Page, country = 'India', nation = 'Red Fox Republic') {
  await page.getByLabel('Nation name').fill(nation)
  await page.getByRole('button', { name: country }).click()
  await page.getByRole('button', { name: 'Lock in' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in' }).click()
  // A new team opens on Build with blocks; these tests work in the code editor
  await page.getByRole('tab', { name: '</> Write code' }).click()
  await expect(page.getByRole('tab', { name: 'strategy.py' })).toBeVisible()
}

/** Waits for the switch to Write code to be autosaved, so a draft a test writes into storage next isn't overwritten on reload. */
async function draftSettled(page: Page) {
  await expect(page.getByText('Draft saved in this browser.')).toBeVisible()
}

async function readyWorkspace(page: Page) {
  await login(page)
  await claim(page)
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
  await expect(page.getByTestId('check')).toHaveText('Ready to submit')
}

const submitButton = (page: Page) => page.getByRole('button', { name: 'Submit strategy' })

test('runs on plain HTTP, where crypto.randomUUID does not exist', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => [window.isSecureContext, typeof crypto.randomUUID])).toEqual([false, 'undefined'])
  await readyWorkspace(page)
  await page.getByRole('button', { name: '+ Block module' }).click()
  await expect(page.locator('.blocklySvg').first()).toBeVisible()
  await page.getByRole('tab', { name: 'strategy.py' }).click()
  await submitButton(page).click()
  await expect(page.getByText('v1', { exact: true })).toBeVisible()
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible()
})

test.describe('bad saved data', () => {
  for (const [name, value] of [
    ['not JSON', '{{{'],
    ['the wrong shape', '{"access":"a","team":5}'],
    ['from the old version', '{"access":"a","refresh":"b","user":{"id":"1","username":"x","role":"team","team":null}}'],
    ['null', 'null'],
  ]) {
    test(`a stored session that is ${name} leads to login`, async ({ page }) => {
      await page.goto('/')
      await page.evaluate((v) => localStorage.setItem('ic.session', v), value)
      await page.reload()
      await expect(page.getByLabel('Username')).toBeVisible()
    })
  }

  test('a corrupt draft falls back to the template', async ({ page }) => {
    await login(page)
    await claim(page)
    await page.evaluate(() => localStorage.setItem('draft:1:prisoners_dilemma', '{"agent":{"hand_code":5,"modules":"x"},"saved_at":9e15}'))
    await page.reload()
    await expect(page.getByTestId('check')).toHaveText('Ready to submit')
    await expect(page.locator('.monaco-editor').first()).toContainText('def strategy')
  })

  test('a module layout Blockly cannot open stays contained and can be reset', async ({ page }) => {
    await login(page)
    await claim(page)
    await draftSettled(page)
    await page.evaluate(() =>
      localStorage.setItem(
        'draft:1:prisoners_dilemma',
        JSON.stringify({
          saved_at: Date.now() + 100000,
          agent: { hand_code: 'def strategy(m, o):\n    return "C"\n', modules: [{ blocks: { languageVersion: 0, blocks: [{ type: 'no_such_block', x: 0, y: 0 }] } }] },
        }),
      ),
    )
    await page.reload()
    await page.getByRole('tab', { name: /module/ }).click()
    await expect(page.getByText("This module's saved layout can't be opened.")).toBeVisible()
    await page.getByRole('button', { name: 'Start this module again' }).click()
    await expect(page.locator('.blocklySvg').first()).toBeVisible()
    await page.getByRole('tab', { name: 'strategy.py' }).click()
    await expect(page.locator('.monaco-editor').first()).toContainText('def strategy')
  })
})

test.describe('login', () => {
  test('wrong password, garbage answers and a dead server all show a message', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Username').fill('team1')
    await page.getByLabel('Password').fill('wrong')
    await page.getByRole('button', { name: 'Request Clearance' }).click()
    await expect(page.getByText('> CLEARANCE DENIED')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password.')

    await mock(page, 'fail', { '/auth/login': 502 })
    await page.getByRole('button', { name: 'Request Clearance' }).click()
    await expect(page.getByText('> CLEARANCE DENIED')).toHaveCount(0)
    await expect(page.getByRole('alert')).toContainText('Could not reach the server')
    await mock(page, 'fail', {})

    await page.route('**/auth/login', (r) => r.abort())
    await page.getByRole('button', { name: 'Request Clearance' }).click()
    await expect(page.getByRole('alert')).toContainText('Cannot reach')
  })

  test('hammering Enter logs in once', async ({ page }) => {
    let calls = 0
    page.on('request', (r) => {
      if (r.url().endsWith('/auth/login')) calls++
    })
    await page.goto('/')
    await page.getByLabel('Username').fill('team1')
    await page.getByLabel('Password').fill('demo')
    await page.getByLabel('Password').press('Enter')
    // The first Enter may already have logged in and removed this field
    await page.getByLabel('Password').press('Enter', { timeout: 1000 }).catch(() => {})
    await expect(page.getByRole('button', { name: 'Lock in' })).toBeVisible()
    expect(calls).toBe(1)
  })

  test('spectator button opens the war map with a token-less spectator session', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /View Big Board/ }).click()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ic.session') ?? 'null'))
    expect(saved).toEqual({ access: '', username: 'spectator', role: 'spectator', team: null })
  })
})

test.describe('claiming a country', () => {
  const nation = (page: Page) => page.getByLabel('Nation name')
  const claimButton = (page: Page) => page.getByRole('button', { name: 'Lock in' })
  const confirmButton = (page: Page) => page.getByRole('dialog').getByRole('button', { name: 'Lock in' })

  test('search with no match, and the confirm can be cancelled', async ({ page }) => {
    await login(page)
    await page.getByLabel('Search countries').fill('<script>alert(1)</script>')
    await expect(page.getByText('No country matches')).toBeVisible()
    await page.getByLabel('Search countries').fill('')
    await nation(page).fill('Red Fox Republic')
    await page.getByRole('button', { name: 'Brazil' }).click()
    await claimButton(page).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(claimButton(page)).toBeEnabled()
  })

  test('the nation name follows the rules before anything is sent', async ({ page }) => {
    await login(page)
    await page.getByRole('button', { name: 'Brazil' }).click()
    await expect(claimButton(page)).toBeDisabled()
    await nation(page).fill('  ab  ')
    await expect(page.getByText('A nation name is 3 to 24 characters.')).toBeVisible()
    await expect(claimButton(page)).toBeDisabled()
    await nation(page).fill('Red-Fox')
    await expect(page.getByText('can only use letters, numbers and spaces')).toBeVisible()
    await expect(claimButton(page)).toBeDisabled()
    await nation(page).fill('12345')
    await expect(page.getByText('must include at least one letter')).toBeVisible()
    await expect(claimButton(page)).toBeDisabled()
    await nation(page).fill('Red Fox')
    await expect(claimButton(page)).toBeEnabled()
  })

  test('a name already taken keeps the country selected and focuses the name input', async ({ page }) => {
    await login(page, 'team2')
    await claim(page, 'Japan', 'Frost Union')
    await page.getByRole('button', { name: 'Log out' }).click()
    await login(page)
    await nation(page).fill('FROST UNION')
    await page.getByRole('button', { name: 'Brazil' }).click()
    await claimButton(page).click()
    await confirmButton(page).click()
    await expect(page.getByRole('alert')).toContainText('already claimed')
    await expect(page.locator('p', { hasText: 'BRAZIL' })).toBeVisible()
    await expect(nation(page)).toBeFocused()
    await nation(page).fill('Red Fox')
    await claimButton(page).click()
    await confirmButton(page).click()
    await page.getByRole('tab', { name: '</> Write code' }).click()
    await expect(page.getByRole('tab', { name: 'strategy.py' })).toBeVisible()
    await expect(page.locator('header').getByText('Red Fox')).toBeVisible()
  })

  test('ALREADY_CLAIMED re-reads /me and goes to the workspace', async ({ page }) => {
    await login(page)
    await nation(page).fill('Red Fox')
    await page.getByRole('button', { name: 'Brazil' }).click()
    await claimButton(page).click()
    let intercepted = false
    await page.route('**/teams/claim', async (r) => {
      if (!intercepted) {
        intercepted = true
        // Let the real claim succeed on the server, then return 409 ALREADY_CLAIMED to the client
        await r.fetch({ url: r.request().url().replace('lab.test', '127.0.0.1') })
        await r.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'ALREADY_CLAIMED', message: 'Your team has already claimed a territory.' } }),
        })
        return
      }
      await r.continue()
    })
    await confirmButton(page).click()
    await page.getByRole('tab', { name: '</> Write code' }).click()
    await expect(page.getByRole('tab', { name: 'strategy.py' })).toBeVisible()
  })

  test('another team taking the selected country clears it', async ({ page }) => {
    await login(page)
    await page.getByRole('button', { name: 'Brazil' }).click()
    await expect(page.locator('p', { hasText: 'BRAZIL' })).toBeVisible()
    await mock(page, 'take', { code: 'BR' })
    await expect(page.getByRole('alert')).toContainText('just claimed')
    await expect(page.getByRole('button', { name: 'Brazil' })).toBeDisabled()
  })

  test('losing the race at the last moment is explained', async ({ page }) => {
    await login(page)
    await nation(page).fill('Red Fox')
    await page.getByRole('button', { name: 'Brazil' }).click()
    await claimButton(page).click()
    await page.route('**/teams/claim', (r) =>
      r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TERRITORY_TAKEN', message: 'This territory has already been claimed.' } }) }),
    )
    await confirmButton(page).click()
    await expect(page.getByRole('alert')).toContainText('already been claimed')
  })

  test('a failed country list offers a retry', async ({ page }) => {
    await mock(page, 'fail', { '/territories': 500 })
    await login(page)
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await mock(page, 'fail', {})
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('button', { name: 'Brazil' })).toBeVisible()
  })
})

test.describe('submitting', () => {
  test('double clicks store one version', async ({ page }) => {
    await readyWorkspace(page)
    await submitButton(page).dblclick()
    await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible()
    const stored = await (await mock(page, 'submissions')).json()
    expect(stored).toHaveLength(1)
  })

  test('code over the limit blocks submitting with a clear reason', async ({ page }) => {
    await login(page)
    await claim(page)
    await draftSettled(page)
    await page.evaluate(() =>
      localStorage.setItem('draft:1:prisoners_dilemma', JSON.stringify({ saved_at: Date.now() + 100000, agent: { hand_code: 'def strategy(m,o):\n' + '#'.repeat(70000), modules: [] } })),
    )
    await page.reload()
    await expect(page.getByTestId('check')).toHaveText('Code is too long')
    await expect(submitButton(page)).toBeDisabled()
  })

  test('code problems block submitting until they are fixed', async ({ page }) => {
    await readyWorkspace(page)
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('x = 1')
    await expect(page.getByTestId('check')).toHaveText('1 problem')
    await expect(submitButton(page)).toBeDisabled()
  })

  test('with the server unreachable the draft survives and a reload restores it', async ({ page }) => {
    await readyWorkspace(page)
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('# keep me')
    await expect(page.getByText('Draft saved in this browser.')).toBeVisible()
    await page.route('**/submissions', (r) => r.abort())
    await submitButton(page).click()
    await expect(page.getByText('Could not reach the server. Your draft is saved')).toBeVisible({ timeout: 15_000 })
    await page.unroute('**/submissions')
    await page.reload()
    await expect(page.locator('.monaco-editor').first()).toContainText('keep me')
  })

  test('reloading with the whole server gone keeps the login and the draft', async ({ page }) => {
    await readyWorkspace(page)
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('# typed before the crash')
    await expect(page.getByText('Draft saved in this browser.')).toBeVisible()
    await page.route('http://lab.test:8022/**', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }))
    await page.reload()
    await expect(page.locator('.monaco-editor').first()).toContainText('typed before the crash', { timeout: 20_000 })
    await expect(page.getByLabel('Username')).toHaveCount(0)
  })

  test('a window that closed unnoticed gets the server’s answer, then the screen catches up', async ({ page }) => {
    await readyWorkspace(page)
    await page.route('**/submissions', (r) =>
      r.request().method() === 'POST'
        ? r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ROUND_NOT_OPEN', message: 'The submission window is closed' } }) })
        : r.continue(),
    )
    await submitButton(page).click()
    await expect(page.getByText('The submission window is closed')).toBeVisible()
    // An answer about this request, not about the login
    await expect(page.getByLabel('Username')).toHaveCount(0)
  })

  test('sends the code as one file that runs on its own, with the round and the layout', async ({ page }) => {
    await readyWorkspace(page)
    await page.getByRole('button', { name: '+ Block module' }).click()
    await page.getByLabel('Start from an example').selectOption('Tit for Tat')
    await page.getByRole('button', { name: 'Use as my strategy' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Use as my strategy' }).click()
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('vs Tit for tat')
    const [stored] = await (await mock(page, 'submissions')).json()
    // The first turn reaches no play block, so the module ends with the round's first move, never None
    expect(stored.code).toContain('# No block above decided, so play the safe default\n    return "C"')
    expect(stored.code).not.toContain('return None')
    expect(stored.roundId).toBe(1)
    expect(stored.blocks.modules).toHaveLength(1)
    expect(stored.code.indexOf('def strategy')).toBeLessThan(stored.code.indexOf('def module1'))
    // No helper functions defined: the code must work from the histories alone
    const out = execFileSync('python3', ['-c', `${stored.code}\nprint(strategy(["C"], ["D"]), strategy([], []))`]).toString().trim()
    expect(out).toBe('D C')
  })

  test('a retry reuses the same key and stores one version; a new click gets a new key', async ({ page }) => {
    await readyWorkspace(page)
    const keys: string[] = []
    let first = true
    await page.route('**/submissions', (r) => {
      if (r.request().method() !== 'POST') return r.continue()
      keys.push(r.request().headers()['idempotency-key'])
      if (first) {
        first = false
        return r.abort()
      }
      return r.continue()
    })
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('vs Tit for tat', { timeout: 10_000 })
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(await (await mock(page, 'submissions')).json()).toHaveLength(1)
    await submitButton(page).click()
    await expect(page.getByText('v2', { exact: true })).toBeVisible()
    expect(keys[2]).not.toBe(keys[0])
  })

  test('code without blocks still sends an empty block list, as the backend requires', async ({ page }) => {
    await readyWorkspace(page)
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('vs Tit for tat')
    const [stored] = await (await mock(page, 'submissions')).json()
    expect(stored.blocks).toEqual({ modules: [] })
    expect(stored.code).toContain('def strategy')
  })

  test('the server refusing the code shows its message', async ({ page }) => {
    await readyWorkspace(page)
    await page.route('**/submissions', (r) =>
      r.request().method() === 'POST'
        ? r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_CODE', message: "Line 3: importing 'os' is not allowed." } }) })
        : r.continue(),
    )
    await submitButton(page).click()
    await expect(page.getByText("importing 'os' is not allowed")).toBeVisible()
  })

  test('a rejected version marks its line in the editor', async ({ page }) => {
    await readyWorkspace(page)
    await mock(page, 'reject', { message: 'Line 4: something is wrong here' })
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('something is wrong here')
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeAttached()
  })

  test('loading an old version asks first, comes back with its blocks, and survives a failed fetch', async ({ page }) => {
    await readyWorkspace(page)
    const editor = page.locator('.monaco-editor').first()
    await page.getByRole('button', { name: '+ Block module' }).click()
    await page.getByLabel('Start from an example').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Use as my strategy' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Use as my strategy' }).click()
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('vs Tit for tat')
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('#laterwork')
    await expect(editor).toContainText('#laterwork')

    await page.route('**/submissions/*', (r) => r.abort())
    await page.getByRole('button', { name: 'Load', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Load version' }).click()
    await expect(page.getByText('Could not load version 1')).toBeVisible()
    await expect(editor).toContainText('#laterwork')

    await page.unroute('**/submissions/*')
    await page.getByRole('button', { name: 'Load', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Load version' }).click()
    await expect(editor).not.toContainText('#laterwork')
    // Only the team's own code in the editor, and the module back as blocks, not as Python
    await expect(editor).not.toContainText('block modules')
    await expect(editor).toContainText('return module1')
    await page.getByRole('tab', { name: /module1/ }).click()
    await expect(page.getByTestId('generated')).toContainText('def module1')
  })

  test('a new computer gets the latest version from the server', async ({ page }) => {
    await readyWorkspace(page)
    const editor = page.locator('.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('#onserver')
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('vs Tit for tat')
    // A new computer has no saved draft
    await page.evaluate(async () => {
      Object.keys(localStorage).filter((k) => k.startsWith('draft:') || k.startsWith('sent:')).forEach((k) => localStorage.removeItem(k))
      await new Promise((done) => {
        const del = indexedDB.deleteDatabase('keyval-store')
        del.onsuccess = del.onerror = del.onblocked = done
      })
    })
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB)
      indexedDB.open = (name: string, ...rest: [number?]) => open(`${name}-new-computer`, ...rest)
    })
    await page.reload()
    await expect(editor).toContainText('#onserver')
    await expect(page.getByTestId('not-sent')).toHaveCount(0)
  })

  test('opening a version in the history shows its results', async ({ page }) => {
    await readyWorkspace(page)
    await submitButton(page).click()
    await expect(page.getByTestId('latest-result')).toContainText('vs Tit for tat')
    await page.getByRole('button', { name: /^v1/ }).click()
    await expect(page.getByRole('listitem').getByText('vs Tit for tat')).toBeVisible()
  })
})

test.describe('the session', () => {
  test('an expired token goes to login with the draft kept', async ({ page }) => {
    await readyWorkspace(page)
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('#keepme')
    await expect(page.getByText('Draft saved in this browser.')).toBeVisible()
    await mock(page, 'expire')
    await expect(page.getByText('Your session ended')).toBeVisible({ timeout: 8_000 })
    await page.getByLabel('Username').fill('team1')
    await page.getByLabel('Password').fill('demo')
    await page.getByRole('button', { name: 'Request Clearance' }).click()
    await expect(page.locator('.monaco-editor').first()).toContainText('#keepme')
  })

  test('an organiser account gets the war map and command console, not a team screen', async ({ page }) => {
    await login(page, 'admin')
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /War Map/ })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Command Console/ })).toBeVisible()
    await page.waitForTimeout(2_500)
    await expect(page.getByLabel('Username')).toHaveCount(0)
  })

  test('a server answer in the wrong shape shows a message, not a crash', async ({ page }) => {
    await page.route('**/auth/login', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"x"}' }))
    await login(page)
    await expect(page.getByRole('alert')).toContainText('could not read')
  })
})

test.describe('the timer', () => {
  test('follows the organisers: extend, then close', async ({ page }) => {
    await readyWorkspace(page)
    await expect(page.getByTestId('timer')).toContainText('Window closes in')
    await expect(page.getByTestId('defcon')).toContainText('3')

    await mock(page, 'round', { closes_in: 30 })
    await expect(page.getByTestId('timer').locator('p').first()).toHaveText(/^00:[12]\d|00:30$/)
    await mock(page, 'round', { closes_in: 600 })
    await expect(page.getByTestId('timer').locator('p').first()).toHaveText(/^(09:\d\d|10:00)$/)
    await expect(submitButton(page)).toBeEnabled()

    await mock(page, 'round', { status: 'running' })
    await expect(page.getByText('Matches are being played')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submissions closed' })).toBeDisabled()
  })

  test('follows the organisers setting the time left: shorter, with the deadline alert, then longer', async ({ page }) => {
    /** The organiser's real action, through the mock's contract route (v5.5), not a /__mock control. */
    const setTime = async (minutes: number) => {
      const login = await page.request.post('http://localhost:8022/auth/login', { data: { username: 'admin', password: 'demo' } })
      const token = (await login.json()).access_token
      const answer = await page.request.post('http://localhost:8022/admin/rounds/1/set-time', { data: { minutes }, headers: { Authorization: `Bearer ${token}` } })
      expect(answer.status()).toBe(200)
    }
    const time = page.getByTestId('timer').locator('p').first()
    await readyWorkspace(page)
    await expect(time).toHaveText(/^(29:\d\d|30:00)$/)

    await setTime(2)
    await expect(time).toHaveText(/^(01:\d\d|02:00)$/)
    // Cut past the 5 minute mark in one go: that alert, and not the 1 minute one yet
    await expect(page.getByText('5 minutes left')).toBeVisible()
    await expect(page.getByText('1 minute left')).toHaveCount(0)
    await expect(submitButton(page)).toBeEnabled()

    await setTime(90)
    await expect(time).toHaveText(/^(1:29:\d\d|1:30:00)$/)
    await expect(submitButton(page)).toBeEnabled()
  })

  test('uses server time when this laptop’s clock is wrong', async ({ page }) => {
    await page.addInitScript(() => {
      const skew = 3 * 3600 * 1000
      const real = Date.now.bind(Date)
      Date.now = () => real() + skew
    })
    await readyWorkspace(page)
    await expect(page.getByTestId('timer').locator('p').first()).toHaveText(/^(29:\d\d|30:00)$/)
  })

  test('shows the connection dropping and coming back', async ({ page }) => {
    await readyWorkspace(page)
    await expect(page.getByText('connected', { exact: true })).toBeVisible()
    await mock(page, 'fail', { '/rounds/current': 502 })
    await expect(page.getByText('reconnecting')).toBeVisible()
    await expect(page.getByTestId('timer')).toBeVisible()
    await expect(submitButton(page)).toBeEnabled()
    await mock(page, 'fail', {})
    await expect(page.getByText('connected', { exact: true })).toBeVisible()
  })
})

test('a round that failed to load recovers on its own', async ({ page }) => {
  await login(page)
  await claim(page)
  await mock(page, 'fail', { '/rounds/current': 500 })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Submissions closed' })).toBeVisible()
  await mock(page, 'fail', {})
  await expect(submitButton(page)).toBeVisible({ timeout: 8_000 })
})

test('a server error while restoring still gives the team an editor', async ({ page }) => {
  await login(page)
  await claim(page)
  await mock(page, 'fail', { '/submissions': 500 })
  await page.reload()
  await expect(page.locator('.monaco-editor').first()).toContainText('def strategy', { timeout: 20_000 })
})

test('logging out returns to login and the next team sees nothing of the last', async ({ page }) => {
  await readyWorkspace(page)
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('# team one secret')
  await page.getByRole('button', { name: 'Log out' }).click()
  await login(page, 'team2')
  await claim(page, 'Japan', 'Frost Union')
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).not.toContainText('team one secret')
})

test.describe('the three rounds', () => {
  const editor = (page: Page) => page.locator('.monaco-editor').first()
  const round = (page: Page, index: number) => mock(page, 'goto', { index })

  test('the header and timer follow DEFCON 3, 2, 1, then ZERO', async ({ page }) => {
    await readyWorkspace(page)
    await expect(page.getByText('DEFCON ZERO').first()).toBeVisible()
    await expect(page.getByText('Round 1 of 3')).toBeVisible()
    await expect(page.getByTestId('defcon')).toContainText('3')
    await round(page, 2)
    await expect(page.getByTestId('defcon')).toContainText('2')
    await round(page, 3)
    await expect(page.getByTestId('defcon')).toContainText('1')
    await mock(page, 'round', { status: 'published' })
    await expect(page.getByTestId('defcon')).toContainText('ZERO')
  })

  test('each round opens its own game, and earlier code waits with its own round', async ({ page }) => {
    await readyWorkspace(page)
    await expect(page.getByRole('button', { name: '+ Block module' })).toBeEnabled()
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('#roundonework')
    await expect(editor(page)).toContainText('roundonework')
    await expect(page.getByText('Draft saved in this browser.')).toBeVisible()

    await round(page, 2)
    await expect(page.getByText('Round 2 of 3')).toBeVisible()
    await expect(page.getByText('split 100 troops across 5 regions')).toBeVisible()
    await expect(page.getByTestId('troops-placed')).toContainText('0 / 100 troops placed')
    await page.getByRole('button', { name: 'Spread evenly' }).click()
    await expect(page.getByTestId('troops-placed')).toContainText('100 / 100 troops placed')
    await page.getByRole('tab', { name: /Write code/ }).click()
    await expect(editor(page)).toContainText('[20, 20, 20, 20, 20]')
    await expect(page.getByRole('button', { name: '+ Block module' })).toHaveCount(0)

    await round(page, 3)
    await expect(page.getByText('Nations take turns as sender and receiver')).toBeVisible()
    await expect(editor(page)).toContainText('received = 3 * opp_history[-1]')

    await round(page, 1)
    await expect(editor(page)).toContainText('roundonework')
  })

  test('a version from an earlier round is not promised as playing this one', async ({ page }) => {
    await readyWorkspace(page)
    await submitButton(page).click()
    await expect(page.getByText('Version 1 is your latest accepted strategy')).toBeVisible()
    await round(page, 2)
    await expect(page.getByText('You have no accepted strategy yet.')).toBeVisible()
    await expect(page.getByText('No submissions yet.')).toBeVisible()
    await page.reload()
    await page.getByRole('tab', { name: /Write code/ }).click()
    await expect(editor(page)).toContainText('[20, 20, 20, 20, 20]')
  })

  test('a game this client has never heard of reports a could-not-read error', async ({ page }) => {
    await readyWorkspace(page)
    await mock(page, 'round', { game: 'surprise' })
    await expect(page.getByText('could not read')).toBeVisible()
    await expect(editor(page)).toContainText('def strategy')
  })
})

test('routes outside the contract are never called, and nobody is told they are being reported', async ({ page }) => {
  const called: string[] = []
  page.on('request', (r) => {
    if (/:8022\/(practice|fairplay|ws|clock|config|api)\b/.test(r.url())) called.push(r.url())
  })
  await readyWorkspace(page)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(5_500)
  await expect(page.getByText('reported to the invigilators')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run practice match' })).toHaveCount(0)
  expect(called).toEqual([])
})

test('fast typing never loses a keystroke, and loading a version still replaces the text', async ({ page }) => {
  await readyWorkspace(page)
  const editor = page.locator('.monaco-editor').first()
  await submitButton(page).click()
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible()
  for (const word of ['#fastone', '#fasttwo', '#fastthree']) {
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(word)
    await expect(editor).toContainText(word)
  }
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await page.getByRole('button', { name: 'Load version' }).click()
  await expect(editor).not.toContainText('#fastone')
  await expect(editor).toContainText('def strategy')
})

test.describe('blocks', () => {
  const addModule = async (page: Page) => {
    await readyWorkspace(page)
    await page.getByRole('button', { name: '+ Block module' }).click()
    await expect(page.locator('.blocklyToolbox, .blocklyToolboxDiv').first()).toBeVisible()
  }
  const flyoutCount = async (page: Page, category: string) => {
    await page.getByRole('treeitem', { name: category }).click()
    await expect(page.locator('.blocklyFlyout .blocklyDraggable').first()).toBeVisible()
    const count = await page.locator('.blocklyFlyout .blocklyWorkspace > .blocklyBlockCanvas > .blocklyDraggable').count()
    return count
  }

  test('the toolbox offers exactly eleven blocks, in five categories', async ({ page }) => {
    await addModule(page)
    const counts: number[] = []
    for (const category of ['Actions', 'Logic', 'Opponent', 'Me & match', 'Chance']) counts.push(await flyoutCount(page, category))
    expect(counts).toEqual([1, 4, 3, 2, 1])
    expect(counts.reduce((a, b) => a + b)).toBe(11)
  })

  test('dragging a block changes the Python, and that Python runs', async ({ page }) => {
    await addModule(page)
    // An empty module already plays: it falls back to the round's first move
    await expect(page.getByTestId('generated')).toContainText('# No block above decided, so play the safe default\n    return "C"')
    await expect(page.getByTestId('generated')).not.toContainText('return None')
    await page.getByRole('treeitem', { name: 'Actions' }).click()
    const play = page.locator('.blocklyFlyout .blocklyDraggable').first()
    const from = (await play.boundingBox())!
    const target = (await page.locator('.blocklyMainWorkspaceDiv, .blocklySvg').first().locator('.blocklyBlockCanvas .blocklyDraggable').first().boundingBox())!
    await page.mouse.move(from.x + 12, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + 60, target.y + 44, { steps: 12 })
    await page.mouse.up()
    // The play block now decides every turn, so the fallback is gone and the block's own move is played
    await expect(page.getByTestId('generated')).not.toContainText('# No block above decided, so play the safe default')
    await expect(page.getByTestId('generated')).toContainText('return "C"')

    const code = await page.getByTestId('generated').innerText()
    const program = `${code}\nprint(module1([], []))`
    expect(execFileSync('python3', ['-c', program]).toString().trim()).toBe('C')
  })

  test('a full layout gives Python that plays correctly, and an unfinished one blocks submit', async ({ page }) => {
    await login(page)
    await claim(page)
    await draftSettled(page)
    const ifElse = (condition: unknown, then: unknown, otherwise: unknown) => ({ type: 'controls_ifelse', inputs: { IF0: { block: condition }, DO0: { block: then }, ELSE: { block: otherwise } } })
    const play = (MOVE: string) => ({ type: 'ic_play', fields: { MOVE } })
    const body = ifElse(
      { type: 'ic_first_turn' },
      play('C'),
      ifElse({ type: 'ic_opp_rate', fields: { MOVE: 'D', OP: 'GT', PERCENT: 50 } }, play('D'), ifElse({ type: 'ic_opp_last', fields: { MOVE: 'D' } }, play('D'), play('C'))),
    )
    const save = (root: unknown) =>
      page.evaluate((b) => {
        const module = { type: 'ic_module', x: 24, y: 24, deletable: false, fields: { NAME: 'punish' }, inputs: b ? { BODY: { block: b } } : {} }
        localStorage.setItem('draft:1:prisoners_dilemma', JSON.stringify({ saved_at: Date.now() + 100000, agent: { hand_code: 'def strategy(m, o):\n    return "C"\n', modules: [{ blocks: { languageVersion: 0, blocks: [module] } }] } }))
      }, root)
    await save(body)
    await page.reload()
    await page.getByRole('tab', { name: /punish/ }).click()
    await expect(page.getByTestId('generated')).toContainText('opp_history.count("D") > 0.5 * len(opp_history)')
    await expect(submitButton(page)).toBeEnabled()

    const code = await page.getByTestId('generated').innerText()
    // Nothing but the module: it must work from the histories alone
    const program = `${code}
for h in (["C", "C", "C"], ["D", "D", "C"], ["C", "C", "D"], []):
    print(punish(["C"] * len(h), h))`
    expect(execFileSync('python3', ['-c', program]).toString().trim().split(/\s+/)).toEqual(['C', 'D', 'D', 'C'])

    await save({ type: 'controls_ifelse' })
    await page.reload()
    await expect(page.getByTestId('check')).toHaveText('1 problem')
    await expect(page.getByRole('button', { name: 'Submit strategy' })).toBeDisabled()
  })
})

test.describe('blocks for round 1', () => {
  const ifElse = (condition: unknown, then: unknown, otherwise: unknown) => ({ type: 'controls_ifelse', inputs: { IF0: { block: condition }, DO0: { block: then }, ELSE: { block: otherwise } } })
  const play = (MOVE: string) => ({ type: 'ic_play', fields: { MOVE } })

  async function open(page: Page, body: unknown) {
    await login(page)
    await claim(page)
    await draftSettled(page)
    await page.evaluate(
      (b) => {
        const module = { type: 'ic_module', x: 24, y: 24, deletable: false, fields: { NAME: 'plan' }, inputs: { BODY: { block: b } } }
        localStorage.setItem('draft:1:prisoners_dilemma', JSON.stringify({ saved_at: Date.now() + 100000, agent: { hand_code: 'def strategy(m, o):\n    return plan(m, o)\n', modules: [{ blocks: { languageVersion: 0, blocks: [module] } }] } }))
      },
      body,
    )
    await page.reload()
    await page.getByRole('tab', { name: /plan/ }).click()
    await expect(page.locator('.blocklySvg').first()).toBeVisible()
  }

  test("a move from another round is reported, not sent", async ({ page }) => {
    await open(page, play('ATTACK'))
    await expect(page.getByText("uses a move that isn't in this round")).toBeVisible()
    await expect(submitButton(page)).toBeDisabled()
  })

  test('limits come from the round: blocks in total and number of modules', async ({ page }) => {
    await open(page, ifElse({ type: 'ic_first_turn' }, play('C'), play('D')))
    await expect(page.getByText('of 40 blocks in total')).toBeVisible()
    await mock(page, 'round', { config: { block_limit: 3 } })
    await expect(page.getByText('This round allows 3 blocks in total')).toBeVisible()
    await expect(submitButton(page)).toBeDisabled()
    await mock(page, 'round', { config: { block_limit: 40, max_modules: 1 } })
    await expect(submitButton(page)).toBeEnabled()
    await expect(page.getByRole('button', { name: '+ Block module' })).toBeDisabled()
  })
})

test.describe('building a strategy with blocks only', () => {
  const picker = (page: Page) => page.getByLabel('Start from an example')
  const check = `for h in ([], ["C"], ["D"], ["D", "D", "C"]):
    assert module1(["C"] * len(h), h) in ("C", "D")`

  test('every round 1 example builds Python that plays', async ({ page }) => {
    await readyWorkspace(page)
    await expect(page.getByText('Round 1 of 3')).toBeVisible()
    await page.getByRole('button', { name: '+ Block module' }).click()
    const names = (await picker(page).locator('option').allTextContents()).slice(1)
    expect(names.length).toBeGreaterThan(2)
    for (const [i, name] of names.entries()) {
      await picker(page).selectOption({ label: name })
      if (i > 0) await page.getByRole('button', { name: 'Use example' }).click()
      await expect(page.locator('.blocklySvg').first()).toBeVisible()
      await expect(page.getByTestId('generated')).not.toContainText('return None')
      await expect(page.getByText('Some situations reach no move')).toHaveCount(0)
      const code = await page.getByTestId('generated').innerText()
      execFileSync('python3', ['-c', `import random\n${code}\n${check}`])
    }
  })

  test('one click makes a module the strategy, and it survives a reload and submits', async ({ page }) => {
    await readyWorkspace(page)
    await page.getByRole('button', { name: '+ Block module' }).click()
    await expect(page.getByText("This module won't play yet")).toBeVisible()
    // An empty module is no longer flagged: it ends with a legal fallback move instead
    await expect(page.getByText('Some situations reach no move')).toHaveCount(0)
    await expect(page.getByTestId('generated')).toContainText('# No block above decided, so play the safe default\n    return "C"')
    await picker(page).selectOption('Always Betray')
    // Every path now plays betray, so no fallback is added
    await expect(page.getByTestId('generated')).toHaveText('def module1(my_history, opp_history):\n    return "D"')
    await expect(page.getByText('Some situations reach no move')).toHaveCount(0)
    await page.getByRole('button', { name: 'Use as my strategy' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Use as my strategy' }).click()
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toContainText('module1(my_history,')
    await page.getByRole('tab', { name: /module1/ }).click()
    await expect(page.getByText("This module won't play yet")).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.monaco-editor').first()).toContainText('module1(my_history,')
    await submitButton(page).click()
    await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible()
  })

  test('picking an example asks before replacing blocks already there', async ({ page }) => {
    await readyWorkspace(page)
    await page.getByRole('button', { name: '+ Block module' }).click()
    await picker(page).selectOption('Tit for Tat')
    await expect(page.getByTestId('generated')).toContainText('len(opp_history) > 0')
    await picker(page).selectOption('Grudger')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('generated')).toContainText('len(opp_history) > 0')
    await expect(page.getByTestId('generated')).not.toContainText('"D" in opp_history')
  })
})

test.describe('during the window', () => {
  const editor = (page: Page) => page.locator('.monaco-editor').first()
  const result = (page: Page) => page.getByTestId('latest-result')

  test('test results show without opening the history', async ({ page }) => {
    await readyWorkspace(page)
    await expect(result(page)).toHaveCount(0)
    await submitButton(page).click()
    await expect(result(page)).toContainText('vs Tit for tat')
    await expect(result(page)).toContainText('596 – 424')
  })

  test('a rejected version says why, straight away', async ({ page }) => {
    await readyWorkspace(page)
    await mock(page, 'reject', { message: 'Your bot timed out on turn 3' })
    await submitButton(page).click()
    await expect(result(page)).toContainText('Your bot timed out on turn 3')
    await expect(result(page)).toContainText("This version won't play")
  })

  test('changes after submitting are flagged until they are sent, even after a reload', async ({ page }) => {
    await readyWorkspace(page)
    await submitButton(page).click()
    await expect(result(page)).toContainText('vs Tit for tat')
    await expect(page.getByTestId('not-sent')).toHaveCount(0)
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('#changed')
    await expect(page.getByTestId('not-sent')).toBeVisible()
    await expect(page.getByText('Draft saved in this browser.')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('not-sent')).toBeVisible()
    await submitButton(page).click()
    await expect(page.getByTestId('not-sent')).toHaveCount(0)
    await page.reload()
    await expect(editor(page)).toContainText('#changed')
    await expect(page.getByTestId('not-sent')).toHaveCount(0)
  })

  test('warnings fire as the deadline passes 5 minutes and 1 minute', async ({ page }) => {
    await readyWorkspace(page)
    await mock(page, 'round', { closes_in: 303 })
    await expect(page.getByText('5 minutes left')).toBeVisible({ timeout: 8_000 })
    await mock(page, 'round', { closes_in: 63 })
    await expect(page.getByText('1 minute left')).toBeVisible({ timeout: 8_000 })
  })

  test('pressing save keeps the draft and reminds about submitting', async ({ page }) => {
    await readyWorkspace(page)
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('#saved')
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByText('Submit to send it to the server')).toBeVisible()
    await page.reload()
    await expect(editor(page)).toContainText('#saved')
  })
})

test.describe('layout and wording', () => {
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

  test('pop-ups never cover Submit or the latest result', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await readyWorkspace(page)
    await mock(page, 'reject', { message: 'Your bot timed out on turn 3' })
    await submitButton(page).click()
    const result = page.getByTestId('latest-result')
    await expect(result).toContainText('timed out')
    const toasts = page.getByTestId('toasts')
    await expect(toasts.getByRole('button').first()).toBeVisible()
    expect(await toasts.getByRole('button').count()).toBeLessThanOrEqual(2)
    const box = (await toasts.boundingBox())!
    expect(overlap(box, (await submitButton(page).boundingBox())!)).toBe(false)
    expect(overlap(box, (await result.boundingBox())!)).toBe(false)
  })

  test('Submit stays on screen while scrolling the results on a laptop screen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await readyWorkspace(page)
    await submitButton(page).click()
    await page.getByRole('button', { name: 'Load', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeInViewport()
    await expect(submitButton(page)).toBeInViewport({ ratio: 1 })
  })

  test('a module not in use does not read as all clear', async ({ page }) => {
    await readyWorkspace(page)
    await page.getByRole('button', { name: '+ Block module' }).click()
    await expect(page.getByTestId('check')).toHaveText("No errors, but a module isn't used yet")
    await page.getByLabel('Start from an example').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Use as my strategy' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Use as my strategy' }).click()
    await expect(page.getByTestId('check')).toHaveText('Ready to submit')
  })

  test('the header fits a small laptop screen', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 })
    await readyWorkspace(page)
    await expect(page.getByRole('navigation', { name: 'Progress' })).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    const logo = (await page.locator('header').getByText('DEFCON ZERO').boundingBox())!
    const timer = (await page.locator('header').getByText('Window closes').boundingBox())!
    expect(logo.x + logo.width).toBeLessThan(timer.x)
  })

  test('a deadline cut past both alerts gives only the closest one', async ({ page }) => {
    await readyWorkspace(page)
    await mock(page, 'round', { closes_in: 45 })
    await expect(page.getByText('1 minute left')).toBeVisible()
    await expect(page.getByText('5 minutes left')).toHaveCount(0)
  })

  test('a gateway error at login reads plainly', async ({ page }) => {
    await page.goto('/')
    await mock(page, 'fail', { '/auth/login': 502 })
    await page.getByLabel('Username').fill('team1')
    await page.getByLabel('Password').fill('demo')
    await page.getByRole('button', { name: 'Request Clearance' }).click()
    await expect(page.getByText('Could not reach the server')).toBeVisible()
    await expect(page.getByText('502')).toHaveCount(0)
  })

  test('after the window closes the text stops talking about the future', async ({ page }) => {
    await readyWorkspace(page)
    await submitButton(page).click()
    await expect(page.getByText('will play when the window closes')).toBeVisible()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.type('#x')
    await expect(page.getByTestId('not-sent')).toBeVisible()
    await mock(page, 'round', { status: 'running' })
    await expect(page.getByText('Version 1 is your strategy for this round.')).toBeVisible()
    await expect(page.getByText('will play when the window closes')).toHaveCount(0)
    await expect(page.getByTestId('not-sent')).toHaveCount(0)
  })

  test('a fallen team sees why, with no timer or submit', async ({ page }) => {
    await readyWorkspace(page)
    await mock(page, 'team', { username: 'team1', change: { status: 'eliminated' } })
    await expect(page.getByText('Nation fallen')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('nothing more can be submitted')).toBeVisible()
    await expect(page.getByTestId('timer')).toHaveCount(0)
    await expect(submitButton(page)).toHaveCount(0)
  })
})

test.describe('build with blocks', () => {
  /** A new team, straight after claiming: Build with blocks is open. */
  async function blocksWorkspace(page: Page, round = 1) {
    if (round > 1) await mock(page, 'goto', { index: round })
    await login(page)
    await page.getByLabel('Nation name').fill('Red Fox Republic')
    await page.getByRole('button', { name: 'India' }).click()
    await page.getByRole('button', { name: 'Lock in' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Lock in' }).click()
    await expect(page.getByRole('tab', { name: '▦ Build with blocks' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.blocklySvg').first()).toBeVisible()
    await expect(page.getByTestId('submitting')).toHaveText('Submitting: your blocks')
  }
  const startFrom = async (page: Page, name: string) => {
    await page.getByRole('button', { name: 'Start from this' }).click()
    const list = page.getByRole('region', { name: 'Start from this' })
    await expect(list).toContainText('bots built from the same example score about the same')
    await list.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  }

  test('submitting a Round 1 example unchanged asks first: Cancel sends nothing, Submit anyway sends it', async ({ page }) => {
    await blocksWorkspace(page)
    await startFrom(page, 'Tit for Tat')
    const python = page.getByTestId('strategy-python')
    await expect(python).toContainText('opp_history[-1] == "D"')
    await expect(page.getByTestId('check')).toHaveText('Ready to submit')

    await submitButton(page).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('This is exactly the Tit for Tat example. Other teams may submit it too, and bots built from the same example score about the same. Change something to stand out?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await (await mock(page, 'submissions')).json()).toEqual([])

    // Never blocked: Submit anyway sends it
    await submitButton(page).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Submit anyway' }).click()
    await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible()
    const [stored] = await (await mock(page, 'submissions')).json()
    // One module: the strategy block. The code is exactly the generated Python shown under the canvas
    expect(stored.blocks.modules).toHaveLength(1)
    expect(stored.blocks.modules[0].blocks.blocks[0].type).toBe('ic_strategy')
    expect(stored.code.trim()).toBe((await python.innerText()).trim())
    expect(execFileSync('python3', ['-c', `${stored.code}\nprint(strategy([], []), strategy(["C"], ["D"]))`]).toString().trim()).toBe('C D')
  })

  test('a Round 3 example unchanged asks first too, and an empty strategy does not', async ({ page }) => {
    await blocksWorkspace(page, 3)
    // The empty strategy is not an example, so it submits straight away
    await submitButton(page).click()
    await expect(page.getByText('v1', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await startFrom(page, 'Grudger')
    await expect(page.getByTestId('strategy-python')).toContainText('return legal_send(0)')
    await submitButton(page).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('This is exactly the Grudger example.')
    await dialog.getByRole('button', { name: 'Submit anyway' }).click()
    await expect(page.getByText('v2', { exact: true })).toBeVisible()
    const stored = await (await mock(page, 'submissions')).json()
    expect(stored).toHaveLength(2)
    const grudger = stored.find((s: { version: number }) => s.version === 2)
    expect(grudger.blocks.modules[0].blocks.blocks[0].type).toBe('fa_strategy')
    expect(grudger.code).toContain('ENDOWMENT = 10')
  })
})
