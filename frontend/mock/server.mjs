/**
 * A stand-in for the backend, so the team screens can be run and
 * tested on their own. It speaks the same API (see openapi.json) on the same port.
 * It does not run bots or check Python properly; that needs the real server.
 *
 * Run it with `npm run mock` and log in as team1 / team2 with the password "demo".
 * Tests drive it through the /__mock routes.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.MOCK_PORT ?? 8000)
const ALL = ['logic', 'history', 'chance']
const COUNTRIES = ['Argentina', 'Australia', 'Brazil', 'Canada', 'Chile', 'Denmark', 'Egypt', 'Finland', 'France', 'Germany', 'India', 'Japan', 'Kenya', 'Mexico', 'Norway', 'Peru', 'Spain', 'Sweden', 'Turkey', 'Vietnam']
const BOTS = [
  { key: 'tit_for_tat', description: 'Copies your last move' },
  { key: 'always_defect', description: 'Always betrays' },
  { key: 'always_cooperate', description: 'Always trusts' },
]

const ROUND_SETUP = {
  1: { name: "The Prisoner's Dilemma", game: { key: 'prisoners_dilemma', name: "The Prisoner's Dilemma" }, turns: 200, noise: 0 },
  2: { name: 'Theatre of War', game: { key: 'theatre_of_war', name: 'Theatre of War' }, turns: 100, noise: 0 },
  3: { name: 'Foreign Aid', game: { key: 'foreign_aid', name: 'Foreign Aid' }, turns: 50, noise: 0.05 },
}

const openRound = (index) => ({
  id: `round-${index}`, index, ...ROUND_SETUP[index],
  hide_turns: false, repetitions: 3, keep_fraction: 0.5, keep_count: null,
  block_rules: { max_modules: 3, max_blocks: 20, categories: ALL },
  status: 'open', opens_at: Date.now() / 1000, closes_at: Date.now() / 1000 + 1800,
  paused_remaining: null, window_open: true, matches_total: 0, matches_done: 0,
})

let db
let seq
const sockets = new Set()

function reset() {
  seq = 0
  db = {
    teams: {
      team1: { id: 'team-1', name: 'Team 1', country_code: null, eliminated_in: null },
      team2: { id: 'team-2', name: 'Team 2', country_code: null, eliminated_in: null },
    },
    countries: COUNTRIES.map((name, i) => ({ code: String(100 + i), name, team_id: null })),
    submissions: [],
    tokens: new Map(),
    round: openRound(1),
    fairplay: [],
    config: { probe_internet: false, probe_url: '' },
    fail: {}, // path -> HTTP status to answer with, for testing failures
  }
}
reset()

function emit(type, payload) {
  const text = JSON.stringify({ seq: ++seq, type, ts: Date.now() / 1000, payload })
  for (const ws of sockets) ws.send(text)
}

const error = (status, code, message, details = {}) => ({ status, body: { error: { code, message, details } } })

function userFor(req) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  const username = db.tokens.get(token)
  return username ? { username, team: db.teams[username] } : null
}

const userOut = (username) => ({ id: `user-${username}`, username, role: 'team', team: db.teams[username] })

function tokenPair(username) {
  const access_token = randomUUID()
  const refresh_token = randomUUID()
  db.tokens.set(access_token, username)
  return { access_token, refresh_token, user: userOut(username) }
}

function validate(body) {
  const errors = []
  if (!/def strategy\s*\(/.test(body.hand_code ?? '')) {
    errors.push({ message: 'Your code must define strategy(my_history, opp_history)', line: 1, module: null, kind: 'code' })
  }
  const modules = (body.modules ?? []).map((m, i) => ({ index: i, name: `module_${i}`, code: '# compiled by the real server', block_count: 1 }))
  return { errors, modules, assembled: body.hand_code ?? '', rules: db.round.block_rules }
}

const summary = ({ hand_code: _code, modules: _modules, code: _text, ...rest }) => rest

function submit(team, body, key) {
  if (team.eliminated_in !== null) return error(403, 'TEAM_ELIMINATED', 'Your nation has fallen and can no longer submit')
  if (!db.round.window_open) return error(409, 'WINDOW_CLOSED', 'The submission window is closed')
  const check = validate(body)
  if (check.errors.length) return error(422, 'CODE_INVALID', check.errors[0].message, { errors: check.errors })
  const mine = db.submissions.filter((s) => s.team_id === team.id)
  const again = key && mine.find((s) => s.key === key)
  if (again) return { status: 202, body: summary(again) }
  const submission = {
    id: randomUUID(), team_id: team.id, key, version: mine.length + 1, module_count: body.modules?.length ?? 0, rule_problems: [],
    status: 'checking', errors: [], test_results: [], code_sha256: 'mock', created_at: Date.now() / 1000, checked_at: null,
    hand_code: body.hand_code, modules: (body.modules ?? []).map((m, i) => ({ index: i, name: `module_${i}`, code: '', layout: m.layout })), code: body.hand_code,
  }
  db.submissions.unshift(submission)
  setTimeout(() => {
    submission.checked_at = Date.now() / 1000
    if (db.rejectNext) {
      submission.status = 'rejected'
      submission.errors = [db.rejectNext]
      db.rejectNext = null
      emit('submission.result', { submission: summary(submission) })
      return
    }
    submission.status = 'accepted'
    submission.test_results = BOTS.map((b) => ({ opponent: b.key, score: 400, opponent_score: 400 }))
    emit('submission.result', { submission: summary(submission) })
  }, 300)
  return { status: 202, body: summary(submission) }
}

function setWindow(change) {
  Object.assign(db.round, change)
  db.round.window_open = db.round.status === 'open' && db.round.paused_remaining === null
  emit('window.updated', { round: db.round })
}

/** Test controls: nothing in the client calls these. */
function control(path, body) {
  switch (path) {
    case '/__mock/reset': reset(); return {}
    case '/__mock/round': setWindow(body); return db.round
    case '/__mock/goto': db.round = openRound(body.index); emit('round.status', { round: db.round }); return db.round
    case '/__mock/fairplay': return db.fairplay
    case '/__mock/practice': return db.practiceGame
    case '/__mock/reject': db.rejectNext = body.message; return {}
    case '/__mock/take': {
      const country = db.countries.find((c) => c.code === body.code)
      country.team_id = 'someone-else'
      emit('team.updated', {})
      return {}
    }
    case '/__mock/fail': db.fail = body; return {}
    case '/__mock/raw': for (const ws of sockets) ws.send(body.text); return {}
    case '/__mock/submission': db.submissions[0].modules[0].layout = body.layout; return {}
    case '/__mock/submissions': return db.submissions.map(summary)
    case '/__mock/drop': for (const ws of sockets) ws.close(1012); return {}
    default: return null
  }
}

function route(req, path, body) {
  if (path === '/api/v1/auth/login') {
    if (!db.teams[body.username] || body.password !== 'demo') return error(401, 'BAD_CREDENTIALS', 'Wrong username or password')
    return { status: 200, body: tokenPair(body.username) }
  }
  if (path === '/api/v1/auth/refresh') return error(401, 'BAD_TOKEN', 'Your session has ended')
  if (path === '/api/v1/clock') return { status: 200, body: { server_time: Date.now() / 1000 } }

  const user = userFor(req)
  if (!user) return error(401, 'UNAUTHENTICATED', 'Log in first')
  const { team, username } = user
  const key = `${req.method} ${path}`
  switch (key) {
    case 'GET /api/v1/config': return { status: 200, body: db.config }
    case 'POST /api/v1/fairplay/events': db.fairplay.push(...body.events); return { status: 200, body: { ok: true } }
    case 'GET /api/v1/me': return { status: 200, body: userOut(username) }
    case 'GET /api/v1/countries': return { status: 200, body: db.countries }
    case 'GET /api/v1/rounds/current': return { status: 200, body: db.round }
    case 'GET /api/v1/practice/bots': return { status: 200, body: BOTS }
    case 'POST /api/v1/practice/validate': return { status: 200, body: validate(body) }
    case 'POST /api/v1/practice/simulate': db.practiceGame = body.game; return { status: 200, body: { score: 150, opponent_score: 150, my_moves: 'C'.repeat(body.turns), opponent_moves: 'C'.repeat(body.turns), forfeit: null } }
    case 'GET /api/v1/submissions': return { status: 200, body: db.submissions.filter((s) => s.team_id === team.id).map(summary) }
    case 'POST /api/v1/submissions': return submit(team, body, req.headers['idempotency-key'])
    case 'POST /api/v1/teams/me/country': {
      if (team.country_code) return error(409, 'ALREADY_CLAIMED', 'Your team already has a country')
      const country = db.countries.find((c) => c.code === body.code)
      if (!country) return error(404, 'NOT_FOUND', 'No such country')
      if (country.team_id) return error(409, 'COUNTRY_TAKEN', `${country.name} has already been claimed`)
      country.team_id = team.id
      team.country_code = country.code
      emit('team.updated', {})
      return { status: 200, body: team }
    }
  }
  const detail = path.match(/^\/api\/v1\/submissions\/(.+)$/)
  if (detail) {
    const found = db.submissions.find((s) => s.id === detail[1] && s.team_id === team.id)
    return found ? { status: 200, body: found } : error(404, 'NOT_FOUND', 'Submission not found')
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

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const token = new URL(req.url, 'http://mock').searchParams.get('token')
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!db.tokens.has(token)) return ws.close(4401)
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
    ws.send(JSON.stringify({ seq: null, type: 'hello', ts: Date.now() / 1000, payload: { head: seq } }))
  })
})

server.listen(PORT, () => console.log(`Mock Command Server on http://localhost:${PORT} (team1 or team2, password: demo)`))
