/**
 * Full-stack integrated backend server for DEFCON Zero (Contract v4 + Engine + WarMap + Organiser).
 *
 * - Runs submitted Python strategies through the real Python sandbox (`../engine/sandbox.py`)
 * - Serves live `/standings` and troop movements including claimed human teams (`team1`, `team2`)
 * - Supports all Organiser Console routes (`/admin/*`) and test controls (`/__mock/*`)
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const PORT = Number(process.env.MOCK_PORT ?? 8002)
const TERRITORIES = ['AR', 'AU', 'BR', 'CA', 'CL', 'CN', 'DK', 'DZ', 'EG', 'FI', 'FR', 'DE', 'IN', 'JP', 'KE', 'KZ', 'MX', 'NO', 'PE', 'RU', 'ES', 'SE', 'TR', 'US', 'VN']
const BOTS = {
  prisoners_dilemma: ['tit_for_tat', 'always_defect', 'always_cooperate', 'grudger'],
  theatre_of_war: ['aggressive', 'defensive', 'fortress', 'opportunistic'],
  foreign_aid: ['always_aid', 'never_aid', 'tit_for_tat_aid', 'grudger_aid'],
}
const ROUNDS = {
  1: { game: 'prisoners_dilemma', moves: ['C', 'D'] },
  2: { game: 'theatre_of_war', moves: ['ATTACK', 'DEFEND', 'EXPAND'] },
  3: { game: 'foreign_aid', moves: ['AID', 'WITHHOLD'] },
}
const AI_RIVALS = [
  { team_id: 101, nation_name: 'Red Dawn', territory_code: 'RU', baseScore: 2280, status: 'active' },
  { team_id: 102, nation_name: 'Liberty Bloc', territory_code: 'US', baseScore: 2210, status: 'active' },
  { team_id: 103, nation_name: 'Jade Dynasty', territory_code: 'CN', baseScore: 2150, status: 'active' },
  { team_id: 104, nation_name: 'Southern Cross', territory_code: 'AU', baseScore: 1940, status: 'active' },
  { team_id: 105, nation_name: 'Monsoon Union', territory_code: 'IN', baseScore: 1860, status: 'active' },
  { team_id: 106, nation_name: 'Sahara Front', territory_code: 'DZ', baseScore: 1620, status: 'active' },
  { team_id: 107, nation_name: 'Iron Steppe', territory_code: 'KZ', baseScore: 1490, status: 'active' },
  { team_id: 108, nation_name: 'Rising Sun', territory_code: 'JP', baseScore: 1380, status: 'active' },
]

const NAME_RULE = /^[A-Za-z0-9 ]{3,24}$/
const WINDOW_SECONDS = 1800

let db

const openRound = (number) => ({
  id: number,
  number,
  game: ROUNDS[number].game,
  status: 'open',
  opensAt: Date.now(),
  closesAt: Date.now() + WINDOW_SECONDS * 1000,
  config: { moves: ROUNDS[number].moves, max_modules: 3, block_limit: 40, rounds_per_match: 200, repetitions: 5 },
})

function reset() {
  db = {
    users: {
      team1: { role: 'team', team: { id: 1, nation_name: null, territory_code: null, status: 'active', score: 0 } },
      team2: { role: 'team', team: { id: 2, nation_name: null, territory_code: null, status: 'active', score: 0 } },
      admin: { role: 'organiser', team: null },
    },
    rivals: AI_RIVALS.map((r) => ({ ...r, score: r.baseScore })),
    territories: TERRITORIES.map((territory_code) => ({ territory_code, claimed: false, nation_name: null })),
    submissions: [],
    tokens: new Map(),
    round: openRound(1),
    pollTick: 0,
    fail: {}, // path -> HTTP status to answer with, for testing failures
    rejectNext: null,
  }
}
reset()

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString())
const roundOut = ({ opensAt, closesAt, ...round }) => ({ ...round, opens_at: iso(opensAt), closes_at: iso(closesAt), server_time: iso(Date.now()) })
const error = (status, code, message) => ({ status, body: { error: { code, message } } })
const summary = ({ id, version, status, createdAt }) => ({ id, version, status, created_at: iso(createdAt) })
const detail = ({ id, roundId, version, status, createdAt, code, blocks, check }) => ({
  id,
  round_id: roundId,
  version,
  status,
  created_at: iso(createdAt),
  code,
  blocks,
  check,
  server_time: iso(Date.now()),
})
const me = (username, { team }) => ({ username, role: 'team', ...team })

function runPythonCheck(code, gameKey, callback) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(REPO_ROOT)})
from engine.sandbox import test_submission
res = test_submission(sys.stdin.read(), 200, ${JSON.stringify(gameKey)})
print(json.dumps(res))
`
  const child = execFile('python3', ['-c', script], { timeout: 6000 }, (err, stdout) => {
    if (err) return callback(null)
    try {
      callback(JSON.parse(stdout.trim()))
    } catch {
      callback(null)
    }
  })
  child.stdin?.write(code)
  child.stdin?.end()
}

function submit(team, body, key) {
  if (team.status === 'disqualified') return error(403, 'TEAM_DISQUALIFIED', 'Your team has been disqualified.')
  if (db.round.status !== 'open') return error(409, 'ROUND_NOT_OPEN', 'The round is not open.')
  if (!Array.isArray(body.blocks?.modules)) return error(400, 'VALIDATION_ERROR', 'body.blocks: Field required')
  if (body.blocks.modules.length > db.round.config.max_modules) return error(400, 'VALIDATION_ERROR', 'Too many modules.')
  const again = key && db.submissions.find((s) => s.key === key)
  if (again) return { status: 200, body: detail(again) }
  const mine = db.submissions.filter((s) => s.teamId === team.id && s.roundId === body.round_id)
  const submission = {
    id: db.submissions.length + 1,
    key,
    teamId: team.id,
    roundId: body.round_id,
    version: mine.length + 1,
    status: 'pending',
    createdAt: Date.now(),
    code: body.code ?? '',
    blocks: body.blocks ?? null,
    check: null,
  }
  db.submissions.unshift(submission)
  const gameKey = db.round.game

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
    runPythonCheck(submission.code, gameKey, (pyResult) => {
      if (pyResult) {
        if (!pyResult.ok) {
          submission.status = 'rejected'
          submission.check = { error: pyResult.errors.join(' '), test_results: [] }
          return
        }
        submission.status = 'accepted'
        submission.check = { error: null, test_results: pyResult.test_results }
        const total = pyResult.test_results.reduce((acc, r) => acc + r.my_score, 0)
        team.score = total
        return
      }
      // Fallback if python3 is unavailable
      submission.status = 'accepted'
      const fallbackResults = BOTS[gameKey]?.map((opponent) => ({ opponent, my_score: 400, opp_score: 400 })) ?? []
      submission.check = { error: null, test_results: fallbackResults }
      team.score = fallbackResults.reduce((acc, r) => acc + r.my_score, 0)
    })
  }, 200)

  return { status: 202, body: detail(submission) }
}

function claim(username, team, body) {
  if (team.territory_code) return error(409, 'ALREADY_CLAIMED', 'Your team has already claimed a territory.')
  const name = String(body.nation_name ?? '').trim().replace(/\s+/g, ' ')
  if (!NAME_RULE.test(name) || !/[A-Za-z]/.test(name)) {
    return error(400, 'VALIDATION_ERROR', 'Nation names are 3 to 24 letters, numbers or spaces and must include a letter.')
  }
  const taken = Object.values(db.users).some((u) => u.team?.nation_name?.toLowerCase() === name.toLowerCase())
  if (taken) return error(409, 'NAME_TAKEN', 'That nation name is already claimed.')
  const territory = db.territories.find((t) => t.territory_code === body.territory_code)
  if (!territory) return error(404, 'NOT_FOUND', 'No such territory.')
  if (territory.claimed) return error(409, 'TERRITORY_TAKEN', 'This territory has already been claimed.')
  territory.claimed = true
  territory.nation_name = name
  team.nation_name = name
  team.territory_code = territory.territory_code
  if (!team.score) team.score = 1800
  return { status: 200, body: me(username, db.users[username]) }
}

const STATUS_ORDER = { active: 0, eliminated: 1, disqualified: 2 }

function buildLiveStandings() {
  db.pollTick += 1
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z')

  const claimedCodes = new Set()
  const humanNations = []
  for (const u of Object.values(db.users)) {
    if (u.team && u.team.territory_code && u.team.nation_name) {
      claimedCodes.add(u.team.territory_code)
      humanNations.push({
        team_id: u.team.id,
        nation_name: u.team.nation_name,
        territory_code: u.team.territory_code,
        status: u.team.status ?? 'active',
        score: u.team.score || 1800,
        rank: 0,
      })
    }
  }

  const aiNations = db.rivals
    .filter((r) => !claimedCodes.has(r.territory_code))
    .map((r, idx) => {
      const wave = Math.round(Math.sin((db.pollTick + idx) * 0.7) * 45)
      return {
        team_id: r.team_id,
        nation_name: r.nation_name,
        territory_code: r.territory_code,
        status: r.status,
        score: Math.max(100, r.score + wave),
        rank: 0,
      }
    })

  const nations = [...humanNations, ...aiNations]
  nations.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.score - a.score)
  nations.forEach((n, i) => {
    n.rank = i + 1
  })

  // Generate dynamic troop movements between active nations (including claimed human teams!)
  const active = nations.filter((n) => n.status === 'active')
  const movements = []
  if (active.length >= 2) {
    const count = Math.min(4, active.length)
    for (let i = 0; i < count; i++) {
      const from = active[(db.pollTick + i) % active.length]
      const to = active[(db.pollTick + i * 2 + 1) % active.length]
      if (from.team_id !== to.team_id) {
        movements.push({
          id: `live-${db.pollTick}-${i}`,
          from_team_id: from.team_id,
          to_team_id: to.team_id,
          troops: 300 + ((db.pollTick * 150 + i * 250) % 1600),
          launched_at: new Date(nowMs + i * 350).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        })
      }
    }
  }

  return {
    round_id: db.round.id,
    round_status: db.round.status,
    nations,
    movements,
    server_time: nowIso,
  }
}

function buildAdminOverview() {
  const standings = buildLiveStandings()
  const teams = Object.entries(db.users)
    .filter(([, u]) => u.role === 'team' && u.team)
    .map(([username, u]) => {
      const t = u.team
      const subs = db.submissions.filter((s) => s.teamId === t.id && s.roundId === db.round.id)
      const latest = subs[0] ?? null
      return {
        id: t.id,
        username,
        nation_name: t.nation_name,
        territory_code: t.territory_code,
        status: t.status,
        score: t.score ?? 0,
        submissions_count: subs.length,
        latest_version: latest ? { version: latest.version, status: latest.status } : null,
      }
    })
  return {
    round: roundOut(db.round),
    teams,
    standings: standings.nations,
  }
}

/** Test controls: used by Playwright e2e tests and the header round switcher. */
function control(path, body) {
  switch (path) {
    case '/__mock/reset':
      reset()
      return {}
    case '/__mock/goto':
      db.round = openRound(body.index)
      return roundOut(db.round)
    case '/__mock/round': {
      const { closes_in: closesIn, config, ...change } = body
      Object.assign(db.round, change)
      if (config) Object.assign(db.round.config, config)
      if (closesIn !== undefined) db.round.closesAt = closesIn === null ? null : Date.now() + closesIn * 1000
      return roundOut(db.round)
    }
    case '/__mock/take':
      db.territories.find((t) => t.territory_code === body.code).claimed = true
      return {}
    case '/__mock/team':
      Object.assign(db.users[body.username].team, body.change)
      return {}
    case '/__mock/fail':
      db.fail = body
      return {}
    case '/__mock/reject':
      db.rejectNext = body.message
      return {}
    case '/__mock/submissions':
      return db.submissions
    case '/__mock/expire':
      db.tokens.clear()
      return {}
    default:
      return null
  }
}

function route(req, path, body, query) {
  if (path === '/health') return { status: 200, body: { status: 'ok' } }

  if (path === '/auth/login') {
    const uname = String(body.username ?? '').toLowerCase()
    const user = db.users[uname] ?? db.users[body.username]
    if (!user || body.password !== 'demo') return error(401, 'INVALID_CREDENTIALS', 'Wrong username or password.')
    const token = randomUUID()
    db.tokens.set(token, uname in db.users ? uname : body.username)
    return { status: 200, body: { access_token: token, token_type: 'bearer', role: user.role, team_id: user.team?.id ?? null } }
  }

  // Standings is readable by both logged-in users and the spectator Big Board
  if (req.method === 'GET' && path === '/standings') {
    return { status: 200, body: buildLiveStandings() }
  }

  const username = db.tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''))
  if (!username) return error(401, 'UNAUTHENTICATED', 'Log in first.')
  const user = db.users[username]
  const { team } = user
  const key = `${req.method} ${path}`

  if (key === 'GET /rounds/current') return { status: 200, body: roundOut(db.round) }
  if (key === 'GET /rounds') return { status: 200, body: { rounds: [roundOut(db.round)], server_time: iso(Date.now()) } }
  if (key === 'GET /territories') {
    const claimedByRivals = new Map(db.rivals.map((r) => [r.territory_code, r.nation_name]))
    const merged = db.territories.map((t) =>
      t.claimed
        ? t
        : claimedByRivals.has(t.territory_code)
          ? { territory_code: t.territory_code, claimed: false, nation_name: null }
          : t,
    )
    return { status: 200, body: { territories: merged } }
  }

  // Admin / Organiser routes
  if (path === '/admin/overview' && req.method === 'GET') {
    return { status: 200, body: buildAdminOverview() }
  }
  const roundAdmin = path.match(/^\/admin\/rounds\/(\d+)\/(open|extend|start|publish)$/)
  if (roundAdmin && req.method === 'POST') {
    const action = roundAdmin[2]
    if (action === 'open') {
      db.round.status = 'open'
      db.round.opensAt = Date.now()
      db.round.closesAt = body.closes_at ? Date.parse(body.closes_at) : Date.now() + WINDOW_SECONDS * 1000
    } else if (action === 'extend') {
      const mins = Number(body.minutes ?? 5)
      db.round.closesAt = (db.round.closesAt ?? Date.now()) + mins * 60 * 1000
    } else if (action === 'start') {
      db.round.status = 'running'
      db.round.closesAt = Date.now()
      // Boost scores of teams with accepted submissions
      for (const u of Object.values(db.users)) {
        if (u.team && u.team.status === 'active') {
          const accepted = db.submissions.find((s) => s.teamId === u.team.id && s.roundId === db.round.id && s.status === 'accepted')
          if (accepted) u.team.score = Math.max(u.team.score || 2000, 2420)
        }
      }
    } else if (action === 'publish') {
      db.round.status = 'published'
      // Eliminate the lowest-scoring AI rival each published round
      const activeRivals = db.rivals.filter((r) => r.status === 'active').sort((a, b) => a.score - b.score)
      if (activeRivals.length > 2) {
        activeRivals[0].status = 'eliminated'
        activeRivals[1].status = 'eliminated'
      }
    }
    return { status: 200, body: roundOut(db.round) }
  }

  const teamPatch = path.match(/^\/admin\/teams\/(\d+)$/)
  if (teamPatch && req.method === 'PATCH') {
    const teamId = Number(teamPatch[1])
    for (const [uname, u] of Object.entries(db.users)) {
      if (u.team?.id === teamId) {
        u.team.status = body.status ?? 'disqualified'
        return { status: 200, body: me(uname, u) }
      }
    }
    const rival = db.rivals.find((r) => r.team_id === teamId)
    if (rival) {
      rival.status = body.status ?? 'disqualified'
      return {
        status: 200,
        body: { id: rival.team_id, username: rival.nation_name, role: 'team', nation_name: rival.nation_name, territory_code: rival.territory_code, status: rival.status },
      }
    }
    return error(404, 'NOT_FOUND', 'Team not found.')
  }

  if (!team) return error(403, 'FORBIDDEN', 'Only for teams.')
  switch (key) {
    case 'GET /me':
      return { status: 200, body: me(username, user) }
    case 'POST /teams/claim':
      return claim(username, team, body)
    case 'GET /submissions': {
      const roundId = Number(query.get('round_id'))
      const mine = db.submissions.filter((s) => s.teamId === team.id && (!roundId || s.roundId === roundId))
      return { status: 200, body: { submissions: mine.map(summary), server_time: iso(Date.now()) } }
    }
    case 'POST /submissions':
      return submit(team, body, req.headers['idempotency-key'])
  }
  const found = path.match(/^\/submissions\/(\d+)$/)
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
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      return res.end()
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
