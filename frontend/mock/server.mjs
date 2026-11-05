/**
 * A stand-in for the backend, following docs/api.md v2, so the team screens can be
 * run and tested on their own. It does not run bots or check Python properly;
 * that needs the real server. Not used at the event.
 *
 * Run it with `npm run mock` and log in as team1 / team2 with the password
 * "demo", or as admin (an organiser). Tests drive it through the /__mock routes.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 8001)
const TERRITORIES = ['AR', 'AU', 'BR', 'CA', 'CL', 'DK', 'EG', 'FI', 'FR', 'DE', 'IN', 'JP', 'KE', 'MX', 'NO', 'PE', 'ES', 'SE', 'TR', 'VN']
const BOTS = {
  prisoners_dilemma: ['tit_for_tat', 'always_defect', 'always_cooperate'],
  theatre_of_war: ['aggressive', 'defensive', 'fortress'],
  foreign_aid: ['always_aid', 'never_aid', 'tit_for_tat_aid'],
}
const ROUNDS = {
  1: { game: 'prisoners_dilemma', moves: ['C', 'D'] },
  2: { game: 'theatre_of_war', moves: ['ATTACK', 'DEFEND', 'EXPAND'] },
  3: { game: 'foreign_aid', moves: ['AID', 'WITHHOLD'] },
}
const NAME_RULE = /^[A-Za-z0-9 ]{3,24}$/
const WINDOW_SECONDS = 1800

let db

const openRound = (number) => ({
  id: number, number, game: ROUNDS[number].game, status: 'open', opensAt: Date.now(), closesAt: Date.now() + WINDOW_SECONDS * 1000,
  config: { moves: ROUNDS[number].moves, max_modules: 3, block_limit: 40, rounds_per_match: 200, repetitions: 5 },
})

function reset() {
  db = {
    users: {
      team1: { role: 'team', team: { id: 1, nation_name: null, territory_code: null, status: 'active' } },
      team2: { role: 'team', team: { id: 2, nation_name: null, territory_code: null, status: 'active' } },
      admin: { role: 'organiser', team: null },
    },
    territories: TERRITORIES.map((territory_code) => ({ territory_code, claimed: false, nation_name: null })),
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
const detail = ({ id, roundId, version, status, createdAt, code, blocks, check }) => ({ id, round_id: roundId, version, status, created_at: iso(createdAt), code, blocks, check, server_time: iso(Date.now()) })
const me = (username, { team }) => ({ username, role: 'team', ...team })

function submit(team, body, key) {
  if (team.status === 'disqualified') return error(403, 'TEAM_DISQUALIFIED', 'Your team has been disqualified.')
  if (db.round.status !== 'open') return error(409, 'ROUND_NOT_OPEN', 'The round is not open.')
  if ((body.blocks?.modules?.length ?? 0) > db.round.config.max_modules) return error(400, 'VALIDATION_ERROR', 'Too many modules.')
  const again = key && db.submissions.find((s) => s.key === key)
  if (again) return { status: 200, body: detail(again) }
  const mine = db.submissions.filter((s) => s.teamId === team.id && s.roundId === body.round_id)
  const submission = { id: db.submissions.length + 1, key, teamId: team.id, roundId: body.round_id, version: mine.length + 1, status: 'pending', createdAt: Date.now(), code: body.code ?? '', blocks: body.blocks ?? null, check: null }
  db.submissions.unshift(submission)
  setTimeout(() => {
    if (db.rejectNext) {
      submission.status = 'rejected'
      submission.check = { error: db.rejectNext, test_results: [] }
      db.rejectNext = null
      return
    }
    if (!/^\s*def\s+strategy\s*\(/m.test(submission.code)) {
      submission.status = 'rejected'
      submission.check = { error: 'Your code has no strategy function.', test_results: [] }
      return
    }
    submission.status = 'accepted'
    submission.check = { error: null, test_results: BOTS[db.round.game]?.map((opponent) => ({ opponent, my_score: 400, opp_score: 400 })) ?? [] }
  }, 300)
  return { status: 202, body: detail(submission) }
}

function claim(username, team, body) {
  if (team.territory_code) return error(409, 'ALREADY_CLAIMED', 'Your team has already claimed a territory.')
  const name = String(body.nation_name ?? '')
  if (!NAME_RULE.test(name)) return error(400, 'VALIDATION_ERROR', 'Nation names are 3 to 24 letters, numbers or spaces.')
  const taken = Object.values(db.users).some((u) => u.team?.nation_name?.toLowerCase() === name.toLowerCase())
  if (taken) return error(409, 'NAME_TAKEN', 'That nation name is already claimed.')
  const territory = db.territories.find((t) => t.territory_code === body.territory_code)
  if (!territory) return error(404, 'NOT_FOUND', 'No such territory.')
  if (territory.claimed) return error(409, 'TERRITORY_TAKEN', 'This territory has already been claimed.')
  territory.claimed = true
  territory.nation_name = name
  team.nation_name = name
  team.territory_code = territory.territory_code
  return { status: 200, body: me(username, db.users[username]) }
}

/** Test controls: nothing in the client calls these. */
function control(path, body) {
  switch (path) {
    case '/__mock/reset': reset(); return {}
    case '/__mock/goto': db.round = openRound(body.index); return roundOut(db.round)
    case '/__mock/round': {
      const { closes_in: closesIn, config, ...change } = body
      Object.assign(db.round, change)
      if (config) Object.assign(db.round.config, config)
      if (closesIn !== undefined) db.round.closesAt = closesIn === null ? null : Date.now() + closesIn * 1000
      return roundOut(db.round)
    }
    case '/__mock/take': db.territories.find((t) => t.territory_code === body.code).claimed = true; return {}
    case '/__mock/team': Object.assign(db.users[body.username].team, body.change); return {}
    case '/__mock/fail': db.fail = body; return {}
    case '/__mock/reject': db.rejectNext = body.message; return {}
    case '/__mock/submissions': return db.submissions
    case '/__mock/expire': db.tokens.clear(); return {}
    default: return null
  }
}

function route(req, path, body, query) {
  if (path === '/api/v1/auth/login') {
    const user = db.users[body.username]
    if (!user || body.password !== 'demo') return error(401, 'INVALID_CREDENTIALS', 'Wrong username or password.')
    const token = randomUUID()
    db.tokens.set(token, body.username)
    return { status: 200, body: { access_token: token, token_type: 'bearer', role: user.role, team_id: user.team?.id ?? null } }
  }

  const username = db.tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''))
  if (!username) return error(401, 'UNAUTHENTICATED', 'Log in first.')
  const user = db.users[username]
  const { team } = user
  const key = `${req.method} ${path}`
  if (key === 'GET /api/v1/rounds/current') return { status: 200, body: roundOut(db.round) }
  if (key === 'GET /api/v1/territories') return { status: 200, body: { territories: db.territories } }
  if (!team) return error(403, 'FORBIDDEN', 'Only for teams.')
  switch (key) {
    case 'GET /api/v1/me': return { status: 200, body: me(username, user) }
    case 'POST /api/v1/teams/claim': return claim(username, team, body)
    case 'GET /api/v1/submissions': {
      const roundId = Number(query.get('round_id'))
      const mine = db.submissions.filter((s) => s.teamId === team.id && (!roundId || s.roundId === roundId))
      return { status: 200, body: { submissions: mine.map(summary), server_time: iso(Date.now()) } }
    }
    case 'POST /api/v1/submissions': return submit(team, body, req.headers['idempotency-key'])
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
    const url = new URL(req.url, 'http://mock')
    const path = url.pathname
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
    const { status, body: answer } = route(req, path, body, url.searchParams)
    send(status, answer)
  })
})

server.listen(PORT, () => console.log(`Mock backend on http://localhost:${PORT} (team1, team2 or admin, password: demo)`))
