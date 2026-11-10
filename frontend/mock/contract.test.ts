/**
 * The mock must answer every route in docs/api.md with the shapes in contract.ts
 * (frontend/CLAUDE.md rule 3). This starts mock/server.mjs on its own port and walks the
 * whole event through it: login, claim, submit, open, extend, set-time, start, retry, editing
 * the cut, publish and the cut.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { AdminOverview, Health, LoginOut, Me, Round, Rounds, Standings, SubmissionDetail, Submissions, TerritoryList } from '../src/lib/contract'

const PORT = 8032
const BASE = `http://localhost:${PORT}`
let server: ChildProcess

async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(BASE + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  return { status: res.status, json: (await res.json()) as any }
}
const control = (path: string, body: unknown = {}) => call('POST', `/__mock/${path}`, { body })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The answer parses with the contract's schema. */
function shaped<S extends z.ZodType>(schema: S, json: unknown): z.output<S> {
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new Error(`Not the contract's shape: ${JSON.stringify(parsed.error.issues)}\n${JSON.stringify(json)}`)
  return parsed.data
}
const errorCode = (r: { json: any }) => r.json?.error?.code

async function login(username: string) {
  const r = await call('POST', '/auth/login', { body: { username, password: 'demo' } })
  expect(r.status).toBe(200)
  return shaped(LoginOut, r.json).access_token
}

async function until(check: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await wait(100)
  }
  throw new Error('timed out')
}

beforeAll(async () => {
  server = spawn(process.execPath, ['mock/server.mjs'], { env: { ...process.env, MOCK_PORT: String(PORT), MOCK_DEMO: '' }, stdio: 'ignore' })
  await until(async () => {
    try {
      return (await fetch(`${BASE}/health`)).ok
    } catch {
      return false
    }
  })
})
afterAll(() => {
  server?.kill()
})
beforeEach(async () => {
  await control('reset')
})

describe('the mock follows docs/api.md', () => {
  it('public routes answer without a token, and ignore a bad one', async () => {
    for (const token of [undefined, 'not-a-token']) {
      expect(shaped(Health, (await call('GET', '/health', { token })).json).status).toBe('ok')
      expect(shaped(TerritoryList, (await call('GET', '/territories', { token })).json).territories.length).toBe(42)
      expect(shaped(Round, (await call('GET', '/rounds/current', { token })).json).status).toBe('open')
      expect(shaped(Standings, (await call('GET', '/standings', { token })).json).nations).toEqual([])
    }
  })

  it('before any round has started, /rounds/current and /standings are 404', async () => {
    await control('goto', { index: 0 })
    for (const path of ['/rounds/current', '/standings']) {
      const r = await call('GET', path)
      expect([r.status, errorCode(r)]).toEqual([404, 'NOT_FOUND'])
    }
  })

  it('other routes need a token, and the error has the contract shape', async () => {
    for (const path of ['/me', '/rounds', '/admin/overview', '/submissions?round_id=1']) {
      const r = await call('GET', path)
      expect([r.status, errorCode(r), typeof r.json.error.message]).toEqual([401, 'UNAUTHENTICATED', 'string'])
    }
    expect(errorCode(await call('PUT', '/me'))).toBe('METHOD_NOT_ALLOWED')
    expect(errorCode(await call('POST', '/auth/login', { body: { username: 'team1', password: 'nope' } }))).toBe('INVALID_CREDENTIALS')
  })

  it('login and /me: team_id is null until claimed, usernames ignore case, organisers have a profile', async () => {
    const r = await call('POST', '/auth/login', { body: { username: 'Team1', password: 'demo' } })
    expect(shaped(LoginOut, r.json)).toMatchObject({ role: 'team', team_id: null })
    const me = shaped(Me, (await call('GET', '/me', { token: r.json.access_token })).json)
    expect(me).toMatchObject({ username: 'team1', team_id: null, nation_name: null, status: 'active' })
    expect('score' in (await call('GET', '/me', { token: r.json.access_token })).json).toBe(false)
    const admin = shaped(Me, (await call('GET', '/me', { token: await login('admin') })).json)
    expect(admin).toMatchObject({ role: 'organiser', team_id: null, status: 'active' })
  })

  it('claim: cleans the name, and answers every contract error', async () => {
    const token = await login('team1')
    const claim = (territory_code: string, nation_name: string, t = token) => call('POST', '/teams/claim', { token: t, body: { territory_code, nation_name } })
    expect(errorCode(await claim('ZZ', 'Red Dawn'))).toBe('VALIDATION_ERROR')
    expect(errorCode(await claim('RU', '12345'))).toBe('VALIDATION_ERROR')
    expect(errorCode(await claim('RU', 'Red Dawn', await login('admin')))).toBe('FORBIDDEN')
    const me = shaped(Me, (await claim('RU', '  Red   Dawn ')).json)
    expect([me.nation_name, me.territory_code, typeof me.team_id]).toEqual(['Red Dawn', 'RU', 'number'])
    expect(errorCode(await claim('BR', 'Other'))).toBe('ALREADY_CLAIMED')
    const other = await login('team2')
    expect(errorCode(await claim('BR', 'RED DAWN', other))).toBe('NAME_TAKEN')
    expect(errorCode(await claim('RU', 'Blue Dusk', other))).toBe('TERRITORY_TAKEN')
    const list = shaped(TerritoryList, (await call('GET', '/territories')).json)
    expect(list.territories.find((t) => t.territory_code === 'RU')).toMatchObject({ name: 'Russia', claimed: true, nation_name: 'Red Dawn' })
  })

  it('submissions: shapes, idempotency, versions per team, and the 403/404/409/422 cases', async () => {
    const admin = await login('admin')
    const unclaimed = await login('team2')
    const token = await login('team1')
    await call('POST', '/teams/claim', { token, body: { territory_code: 'RU', nation_name: 'Red Dawn' } })
    const body = { round_id: 1, code: 'def strategy(my_history, opp_history):\n    return "C"\n', blocks: { modules: [] } }
    const post = (b: unknown, t = token, key?: string) => call('POST', '/submissions', { token: t, body: b, headers: key ? { 'Idempotency-Key': key } : {} })

    expect(errorCode(await post(body, admin))).toBe('FORBIDDEN')
    expect(errorCode(await post(body, unclaimed))).toBe('FORBIDDEN')
    expect(errorCode(await post({ ...body, round_id: 99 }))).toBe('NOT_FOUND')
    expect(errorCode(await post({ ...body, round_id: 2 }))).toBe('ROUND_NOT_OPEN')
    expect(errorCode(await post({ ...body, blocks: { modules: [{}, {}, {}, {}] } }))).toBe('VALIDATION_ERROR')
    expect(errorCode(await post({ ...body, code: 'x'.repeat(65_537) }))).toBe('VALIDATION_ERROR')

    const first = await post(body, token, 'key-1')
    expect(first.status).toBe(202)
    const pending = shaped(SubmissionDetail, first.json)
    expect([pending.status, pending.round_id, pending.version, pending.tests]).toEqual(['pending', 1, 1, []])
    const again = await post(body, token, 'key-1')
    expect([again.status, shaped(SubmissionDetail, again.json).id]).toEqual([200, pending.id])
    expect(errorCode(await post({ ...body, code: body.code + '#' }, token, 'key-1'))).toBe('IDEMPOTENCY_KEY_REUSED')

    await until(async () => (await call('GET', `/submissions/${pending.id}`, { token })).json.status === 'accepted')
    const done = shaped(SubmissionDetail, (await call('GET', `/submissions/${pending.id}`, { token })).json)
    expect(done.tests.length).toBeGreaterThan(0)
    expect(shaped(SubmissionDetail, (await call('GET', `/submissions/${pending.id}`, { token: admin })).json).id).toBe(pending.id)
    expect(errorCode(await call('GET', `/submissions/${pending.id}`, { token: unclaimed }))).toBe('NOT_FOUND')

    expect(errorCode(await call('GET', '/submissions', { token }))).toBe('VALIDATION_ERROR')
    expect(shaped(Submissions, (await call('GET', '/submissions?round_id=1', { token })).json).map((s) => s.version)).toEqual([1])
    expect(shaped(Submissions, (await call('GET', '/submissions?round_id=1', { token: admin })).json)).toEqual([])
  })

  it('a whole round: open rules, extend, start, a failed run and retry, review scores private, publish and the cut', async () => {
    await control('demo')
    const admin = await login('admin')
    const act = (path: string, body?: unknown, t = admin) => call('POST', `/admin/rounds/${path}`, { token: t, body })

    expect(errorCode(await act('1/open', { minutes: 10 }, await login('demo01')))).toBe('FORBIDDEN')
    expect(errorCode(await act('2/open', { minutes: 10 }))).toBe('INVALID_ROUND_TRANSITION') // round 1 not published yet
    expect(errorCode(await act('1/extend', { minutes: 241 }))).toBe('VALIDATION_ERROR')
    expect(errorCode(await act('1/publish'))).toBe('INVALID_ROUND_TRANSITION')
    expect(shaped(Round, (await act('1/extend', { minutes: 5 })).json).status).toBe('open')

    await control('failrun')
    expect(shaped(Round, (await act('1/start')).json).status).toBe('running')
    expect(errorCode(await act('1/retry'))).toBe('INVALID_ROUND_TRANSITION') // still playing
    await wait(1800)
    expect(shaped(Round, (await call('GET', '/rounds/current')).json).status).toBe('running') // the run failed
    await act('1/retry')
    await until(async () => (await call('GET', '/rounds/current')).json.status === 'review')

    // Review: organisers see scores, the public board still shows nothing published
    const overview = shaped(AdminOverview, (await call('GET', '/admin/overview', { token: admin })).json)
    expect(overview.round.status).toBe('review')
    expect(overview.teams.length).toBe(8)
    expect(overview.unclaimed).toEqual(['demo09', 'demo10', 'team1', 'team2'])
    expect(overview.teams.every((t) => t.score > 0 && t.submission?.status === 'accepted')).toBe(true)
    expect(shaped(Standings, (await call('GET', '/standings')).json)).toMatchObject({ round_status: 'review', nations: [] })

    // Disqualify in review: drops to the bottom with score 0
    const dq = overview.teams[0].team_id
    expect(shaped(Me, (await call('PATCH', `/admin/teams/${dq}`, { token: admin, body: { status: 'disqualified' } })).json).status).toBe('disqualified')
    expect(errorCode(await call('PATCH', `/admin/teams/${dq}`, { token: admin, body: { status: 'gone' } }))).toBe('VALIDATION_ERROR')
    expect(errorCode(await call('PATCH', '/admin/teams/999', { token: admin, body: { status: 'active' } }))).toBe('NOT_FOUND')

    expect(shaped(Round, (await act('1/publish')).json).status).toBe('published')
    const board = shaped(Standings, (await call('GET', '/standings')).json)
    expect(board.nations.map((n) => n.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(board.nations.at(-1)).toMatchObject({ team_id: dq, status: 'disqualified', score: 0 })
    expect(shaped(Rounds, (await call('GET', '/rounds', { token: admin })).json).rounds.map((r) => r.status)).toEqual(['published', 'waiting', 'waiting'])
    expect(shaped(Round, (await act('2/open', { minutes: 20 })).json).status).toBe('open')
  })

  it('v5.5 set-time: closes the window minutes from now, shorter or longer, only while open', async () => {
    const admin = await login('admin')
    const setTime = (minutes: unknown, t = admin) => call('POST', '/admin/rounds/1/set-time', { token: t, body: { minutes } })
    const left = (round: Round) => (round.closesAt! - round.serverTime!) / 60_000

    const longer = shaped(Round, (await setTime(90)).json)
    expect([longer.status, left(longer)]).toEqual(['open', 90])
    const shorter = shaped(Round, (await setTime(2)).json)
    expect(left(shorter)).toBe(2)
    expect(shorter.opensAt).toBe(longer.opensAt)

    // After the deadline it still gives exactly that long
    await control('round', { closes_in: -600 })
    expect(left(shaped(Round, (await setTime(10)).json))).toBe(10)

    for (const minutes of [0, 241, 2.5, 'ten', null]) expect(errorCode(await setTime(minutes))).toBe('VALIDATION_ERROR')
    expect(errorCode(await setTime(5, await login('team1')))).toBe('FORBIDDEN')
    expect(errorCode(await call('POST', '/admin/rounds/9/set-time', { token: admin, body: { minutes: 5 } }))).toBe('NOT_FOUND')
    await call('POST', '/admin/rounds/1/start', { token: admin })
    expect(errorCode(await setTime(5))).toBe('INVALID_ROUND_TRANSITION')
  })

  it('v5.5 cut: config.cut and the overview cut, PATCH /admin/rounds/{id} rules, and publish keeps that many', async () => {
    await control('demo')
    const admin = await login('admin')
    const setCut = async (id: number, cut: unknown, t = admin) => call('PATCH', `/admin/rounds/${id}`, { token: t, body: { cut } })
    const message = (r: { json: any }) => r.json?.error?.message as string

    const rounds = shaped(Rounds, (await call('GET', '/rounds', { token: admin })).json).rounds
    expect(rounds.map((r) => r.config.cut)).toEqual([15, 8, 2])
    expect(shaped(AdminOverview, (await call('GET', '/admin/overview', { token: admin })).json).round.cut).toBe(15)

    for (const cut of [0, -1, 2.5, 'ten', null]) expect(errorCode(await setCut(2, cut))).toBe('VALIDATION_ERROR')
    expect(errorCode(await setCut(2, 5, await login('team1')))).toBe('FORBIDDEN')
    expect(errorCode(await setCut(9, 5))).toBe('NOT_FOUND')

    const final = await setCut(3, 2)
    expect([errorCode(final), message(final)]).toEqual(['VALIDATION_ERROR', "The final round's cut is fixed at 2."])
    const tooBig = await setCut(2, 16)
    expect(errorCode(tooBig)).toBe('VALIDATION_ERROR')
    expect(message(tooBig)).toContain("Raise Round 1's cut first")
    const tooSmall = await setCut(1, 7)
    expect(errorCode(tooSmall)).toBe('VALIDATION_ERROR')
    expect(message(tooSmall)).toContain("Lower Round 2's cut first")
    expect(message(await setCut(2, 1))).toBe("The final round's cut is fixed at 2, so Round 2 must keep at least 2.")

    // Lower round 2 first, then round 1 can go lower too
    expect(shaped(Round, (await setCut(2, 3)).json).config.cut).toBe(3)
    expect(shaped(Round, (await setCut(1, 5)).json).config.cut).toBe(5)
    expect(shaped(AdminOverview, (await call('GET', '/admin/overview', { token: admin })).json).round.cut).toBe(5)

    // Publish keeps the stored cut: the top 5 of 8 stay active
    await call('POST', '/admin/rounds/1/start', { token: admin })
    await until(async () => (await call('GET', '/rounds/current')).json.status === 'review')
    await call('POST', '/admin/rounds/1/publish', { token: admin })
    const board = shaped(Standings, (await call('GET', '/standings')).json)
    expect(board.nations.filter((n) => n.status === 'active').map((n) => n.rank)).toEqual([1, 2, 3, 4, 5])
    expect(board.nations.filter((n) => n.status === 'eliminated').length).toBe(3)

    // A published round's cut can't change, and its neighbour's message names nothing to change
    expect(errorCode(await setCut(1, 6))).toBe('INVALID_ROUND_TRANSITION')
    expect(message(await setCut(2, 6))).toBe('Round 1 kept 5 teams, so Round 2 can keep at most 5.')

    // A reset puts the starting cuts back
    // (a reset also clears every login)
    await control('reset')
    expect(shaped(Rounds, (await call('GET', '/rounds', { token: await login('admin') })).json).rounds.map((r) => r.config.cut)).toEqual([15, 8, 2])
  })

  it('the demo with round 1 published gives a populated board and round 2 open', async () => {
    await control('demo', { publish: true })
    const board = shaped(Standings, (await call('GET', '/standings')).json)
    expect([board.round_status, board.nations.length]).toEqual(['open', 8])
    expect(shaped(Round, (await call('GET', '/rounds/current')).json).game).toBe('theatre_of_war')
  })
})
