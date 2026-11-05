/**
 * A stand-in for the backend, following docs/api.md, so the team screens can be
 * run and tested on their own. It does not run bots or check Python properly;
 * that needs the real server. Not used at the event.
 *
 * Run it with `npm run mock` and log in as team1 / team2 with the password
 * "demo", or as admin (an organiser). Tests drive it through the /__mock routes.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 8001)
const TERRITORIES = [['ARG', 'Argentina'], ['AUS', 'Australia'], ['BRA', 'Brazil'], ['CAN', 'Canada'], ['CHL', 'Chile'], ['DNK', 'Denmark'], ['EGY', 'Egypt'], ['FIN', 'Finland'], ['FRA', 'France'], ['DEU', 'Germany'], ['IND', 'India'], ['JPN', 'Japan'], ['KEN', 'Kenya'], ['MEX', 'Mexico'], ['NOR', 'Norway'], ['PER', 'Peru'], ['ESP', 'Spain'], ['SWE', 'Sweden'], ['TUR', 'Turkey'], ['VNM', 'Vietnam']]
const BOTS = ['tit_for_tat', 'always_defect', 'always_cooperate']
const ROUND_NAMES = { 1: "The Prisoner's Dilemma", 2: 'Theatre of War', 3: 'Foreign Aid' }
const NAME_RULE = /^[A-Za-z0-9 ]{3,24}$/
const WINDOW_SECONDS = 1800

let db

const openRound = (number) => ({ id: number, number, name: ROUND_NAMES[number], defcon: 4 - number, status: 'open', opensAt: Date.now(), closesAt: Date.now() + WINDOW_SECONDS * 1000 })

function reset() {
  db = {
    users: {
      team1: { role: 'team', team: { id: 1, nation_name: null, territory_code: null, status: 'alive' } },
      team2: { role: 'team', team: { id: 2, nation_name: null, territory_code: null, status: 'alive' } },
      admin: { role: 'organiser', team: null },
    },
    territories: TERRITORIES.map(([code, name]) => ({ code, name, claimed: false })),
    submissions: [],
    tokens: new Map(),
    round: openRound(1),
    fail: {}, // path -> HTTP status to answer with, for testing failures
    rejectNext: null,
  }
}
reset()

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString())
const roundOut = ({ opensAt, closesAt, ...round }) => ({ ...round, opens_at: iso(opensAt), closes_at: iso(closesAt), server_time: iso(Date.now()) })
const error = (status, code, message) => ({ status, body: { error: { code, message } } })
const summary = ({ id, version, status, createdAt }) => ({ id, version, status, created_at: iso(createdAt) })
const detail = ({ id, version, status, errors, test_results }) => ({ id, version, status, errors, test_results })

function submit(team, body) {
  if (db.round.status !== 'open') return error(403, 'WINDOW_CLOSED', 'The submission window is closed.')
  if (!/^\s*def\s+strategy\s*\(/m.test(body.code ?? '')) return error(422, 'INVALID_CODE', 'Your code has no strategy function.')
  const mine = db.submissions.filter((s) => s.teamId === team.id)
  const submission = { id: db.submissions.length + 1, teamId: team.id, version: mine.length + 1, status: 'pending', errors: [], test_results: [], createdAt: Date.now(), code: body.code, blocks: body.blocks ?? null }
  db.submissions.unshift(submission)
  setTimeout(() => {
    if (db.rejectNext) {
      submission.status = 'rejected'
      submission.errors = [db.rejectNext]
      db.rejectNext = null
      return
    }
    submission.status = 'accepted'
    submission.test_results = BOTS.map((opponent) => ({ opponent, my_score: 400, opp_score: 400 }))
  }, 300)
  return { status: 202, body: { id: submission.id, version: submission.version, status: submission.status } }
}

function claim(team, body) {
  if (team.territory_code) return error(409, 'ALREADY_CLAIMED', 'Your team has already claimed a territory.')
  const name = String(body.nation_name ?? '')
  if (!NAME_RULE.test(name)) return error(422, 'INVALID_NAME', 'Nation names are 3 to 24 letters, numbers or spaces.')
  const taken = Object.values(db.users).some((u) => u.team?.nation_name?.toLowerCase() === name.toLowerCase())
  if (taken) return error(409, 'NAME_TAKEN', 'That nation name is already used.')
  const territory = db.territories.find((t) => t.code === body.territory_code)
  if (!territory) return error(404, 'NOT_FOUND', 'No such territory.')
  if (territory.claimed) return error(409, 'TERRITORY_TAKEN', 'This territory is already claimed.')
  territory.claimed = true
  team.nation_name = name
  team.territory_code = territory.code
  const { status: _status, ...out } = team
  return { status: 200, body: out }
}

/** Test controls: nothing in the client calls these. */
function control(path, body) {
  switch (path) {
    case '/__mock/reset': reset(); return {}
    case '/__mock/goto': db.round = openRound(body.index); return roundOut(db.round)
    case '/__mock/round': {
      const { closes_in: closesIn, ...change } = body
      Object.assign(db.round, change)
      if (closesIn !== undefined) db.round.closesAt = closesIn === null ? null : Date.now() + closesIn * 1000
      return roundOut(db.round)
    }
    case '/__mock/take': db.territories.find((t) => t.code === body.code).claimed = true; return {}
    case '/__mock/team': Object.assign(db.users[body.username].team, body.change); return {}
    case '/__mock/fail': db.fail = body; return {}
    case '/__mock/reject': db.rejectNext = body.message; return {}
    case '/__mock/submissions': return db.submissions
    case '/__mock/expire': db.tokens.clear(); return {}
    default: return null
  }
}

function route(req, path, body) {
  if (path === '/api/v1/auth/login') {
    const user = db.users[body.username]
    if (!user || body.password !== 'demo') return error(401, 'INVALID_LOGIN', 'Wrong username or password.')
    const token = randomUUID()
    db.tokens.set(token, body.username)
    const team = user.team && { id: user.team.id, nation_name: user.team.nation_name, territory_code: user.team.territory_code }
    return { status: 200, body: { access_token: token, role: user.role, team } }
  }
  if (path === '/api/v1/health') return { status: 200, body: { status: 'ok' } }

  const username = db.tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''))
  if (!username) return error(401, 'UNAUTHORIZED', 'Log in first.')
  const { team } = db.users[username]
  const key = `${req.method} ${path}`
  if (key === 'GET /api/v1/rounds/current') return { status: 200, body: roundOut(db.round) }
  if (key === 'GET /api/v1/territories') return { status: 200, body: db.territories }
  if (!team) return error(403, 'FORBIDDEN', 'Only for teams.')
  switch (key) {
    case 'GET /api/v1/teams/me': return { status: 200, body: team }
    case 'POST /api/v1/teams/me/claim': return claim(team, body)
    case 'GET /api/v1/submissions': return { status: 200, body: db.submissions.filter((s) => s.teamId === team.id).map(summary) }
    case 'POST /api/v1/submissions': return submit(team, body)
  }
  const found = path.match(/^\/api\/v1\/submissions\/(\d+)$/)
  if (found) {
    const submission = db.submissions.find((s) => s.id === Number(found[1]) && s.teamId === team.id)
    return submission ? { status: 200, body: detail(submission) } : error(404, 'NOT_FOUND', 'Submission not found.')
  }
  return error(404, 'NOT_FOUND', `The mock has no ${key}`)
}

const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const path = new URL(req.url, 'http://mock').pathname
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      // answered below as an empty body
    }
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (path.startsWith('/__mock/')) return send(200, control(path, body))
    if (db.fail[path]) {
      res.writeHead(db.fail[path], { 'Content-Type': 'text/html' })
      return res.end('<html>Bad gateway</html>')
    }
    const { status, body: answer } = route(req, path, body)
    send(status, answer)
  })
})

server.listen(PORT, () => console.log(`Mock backend on http://localhost:${PORT} (team1, team2 or admin, password: demo)`))
