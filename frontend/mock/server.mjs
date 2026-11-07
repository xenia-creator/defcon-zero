/**
 * A stand-in for the backend that follows docs/api.md v5.3 route for route, with the same
 * shapes, error codes and round transitions, so every screen can be built and tested
 * without the real server. It does not run bots: checks and match scores are made up
 * (deterministically). Not used at the event.
 *
 *   npm run mock                         team1, team2 (unclaimed) and admin (organiser), password "demo"
 *   MOCK_DEMO=1 npm run mock             also 8 claimed demo teams (demo01..demo08) with accepted round 1
 *                                        versions, and 2 unclaimed accounts (demo09, demo10)
 *   MOCK_DEMO=published npm run mock     as above, with round 1 already played and published,
 *                                        and round 2 open: a populated war map and leaderboard
 *
 * Round 1 starts open, so the team screens work straight away. Tests and demos drive the
 * mock through the /__mock/* control routes at the bottom; the client never calls them,
 * except the organiser console's demo buttons when USE_MOCK_API is on.
 *
 * Keep this file, src/lib/contract.ts and docs/api.md in step: change one, align the others.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 8012)
const DEMO = process.env.MOCK_DEMO ?? ''
const PASSWORD = 'demo'

/** As backend/app/core/territories.py: code → display name, in this order. */
const TERRITORIES = {
  AR: 'Argentina', AU: 'Australia', BR: 'Brazil', CA: 'Canada', CL: 'Chile', DK: 'Denmark', EG: 'Egypt',
  FI: 'Finland', FR: 'France', DE: 'Germany', IN: 'India', JP: 'Japan', KE: 'Kenya', MX: 'Mexico', NO: 'Norway',
  PE: 'Peru', RU: 'Russia', ES: 'Spain', SE: 'Sweden', TR: 'Turkey', VN: 'Vietnam',
}

/** The engine's sample bots per game (engine/registry.py), one test match each. */
const SAMPLE_BOTS = {
  prisoners_dilemma: ['always_cooperate', 'always_defect', 'random_bot', 'tit_for_tat', 'grudger', 'tit_for_two_tats', 'alternator', 'suspicious_tit_for_tat', 'win_stay_lose_shift'],
  theatre_of_war: ['even_split', 'all_in', 'random', 'copy_opponent_last', 'counter_opponent_last'],
  foreign_aid: ['always_send_10_return_half', 'always_send_0_return_0', 'tit_for_tat', 'random', 'adaptive_aid'],
}

/** As backend/app/core/rounds.py. */
const SHARED_LIMITS = { max_modules: 3, block_limit: 40, rounds_per_match: 200, repetitions: 5 }
const ROUND_DEFINITIONS = [
  { number: 1, game: 'prisoners_dilemma', config: { moves: ['C', 'D'], ...SHARED_LIMITS } },
  { number: 2, game: 'theatre_of_war', config: { moves: [], ...SHARED_LIMITS, troops: 100, regions: 5 } },
  { number: 3, game: 'foreign_aid', config: { moves: [], ...SHARED_LIMITS, endowment: 10, multiplier: 3 } },
]
/** How many teams each round keeps at publish: the cut. */
const KEEP = { 1: 15, 2: 8, 3: 2 }

const DEFAULT_WINDOW_MINUTES = 30
const MIN_MINUTES = 1
const MAX_MINUTES = 240
const CHECK_MS = 300
const RUN_MS = 1500
const CODE_MAX_BYTES = 65_536
const BLOCKS_MAX_BYTES = 262_144

const DEMO_TEAMS = [
  ['demo01', 'Red Dawn', 'RU'],
  ['demo02', 'Amazon Pact', 'BR'],
  ['demo03', 'Monsoon Union', 'IN'],
  ['demo04', 'Rising Sun', 'JP'],
  ['demo05', 'Maple Accord', 'CA'],
  ['demo06', 'Southern Cross', 'AU'],
  ['demo07', 'Sahara Front', 'EG'],
  ['demo08', 'Iron Steppe', 'TR'],
]
const DEMO_UNCLAIMED = ['demo09', 'demo10']

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db

function reset() {
  db = {
    nextUserId: 100,
    nextTeamId: 1,
    nextSubmissionId: 1,
    /** username (lowercase) → user. A team account's `team` holds its claim; `team.id` is null until it claims. */
    users: {},
    rounds: ROUND_DEFINITIONS.map((d) => ({ id: d.number, number: d.number, game: d.game, status: 'waiting', opensAt: null, closesAt: null, config: structuredClone(d.config), playing: false })),
    /** round id → [{ teamId, score, rank }], the round's ranked results once its run has finished. */
    results: {},
    submissions: [],
    tokens: new Map(),
    fail: {}, // path → HTTP status to answer with, for testing failures
    rejectNext: null, // the next check is rejected with this message
    failNextRun: false, // the next match run fails and leaves the round running, for retry
  }
  addUser('admin', 'organiser')
  addUser('team1', 'team')
  addUser('team2', 'team')
  openWindow(db.rounds[0], DEFAULT_WINDOW_MINUTES)
  if (DEMO) seedDemo(DEMO === 'published')
}

function addUser(username, role) {
  const user = { id: ++db.nextUserId, username, role, team: role === 'team' ? { id: null, nation_name: null, territory_code: null, status: 'active' } : null }
  db.users[username] = user
  return user
}

function claimFor(user, nationName, code) {
  user.team.id = db.nextTeamId++
  user.team.nation_name = nationName
  user.team.territory_code = code
}

function seedDemo(publish) {
  for (const [username, nation, code] of DEMO_TEAMS) {
    if (db.users[username]) continue
    const user = addUser(username, 'team')
    if (claimedTeams().some((t) => t.territory_code === code)) continue
    claimFor(user, nation, code)
    const round = currentRound() ?? db.rounds[0]
    const s = newSubmission(user.team, round.id, 'def strategy(my_history, opp_history):\n    return opp_history[-1] if opp_history else "C"\n', { modules: [] }, null)
    finishCheck(s, round.game)
  }
  for (const username of DEMO_UNCLAIMED) if (!db.users[username]) addUser(username, 'team')
  if (publish) {
    const round = db.rounds[0]
    if (round.status === 'open') {
      round.status = 'running'
      round.closesAt = Date.now()
    }
    if (round.status === 'running') scoreRound(round)
    if (round.status === 'review') publishRound(round)
    if (db.rounds[1].status === 'waiting') openWindow(db.rounds[1], DEFAULT_WINDOW_MINUTES)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString())
const now = () => Date.now()
const error = (status, code, message) => ({ status, body: { error: { code, message } } })
const ok = (body, status = 200) => ({ status, body })
const isInt = (n) => Number.isInteger(n)

const teamAccounts = () => Object.values(db.users).filter((u) => u.role === 'team')
const claimedUsers = () => teamAccounts().filter((u) => u.team.id !== null)
const claimedTeams = () => claimedUsers().map((u) => u.team)
const userOfTeam = (teamId) => claimedUsers().find((u) => u.team.id === teamId)
const roundById = (id) => db.rounds.find((r) => r.id === id)
/** The highest-numbered round that has left waiting, as GET /rounds/current. */
const currentRound = () => [...db.rounds].reverse().find((r) => r.status !== 'waiting') ?? null

function openWindow(round, minutes) {
  round.status = 'open'
  round.opensAt = now()
  round.closesAt = now() + minutes * 60_000
}

const roundOut = (r) => ({ id: r.id, number: r.number, game: r.game, status: r.status, opens_at: iso(r.opensAt), closes_at: iso(r.closesAt), config: r.config, server_time: iso(now()) })

/** GET /me body, for anyone. */
function profile(user) {
  const team = user.team
  return {
    id: user.id,
    team_id: team?.id ?? null,
    username: user.username,
    role: user.role,
    nation_name: team?.nation_name ?? null,
    territory_code: team?.territory_code ?? null,
    status: team?.status ?? 'active',
  }
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

const summary = (s) => ({ id: s.id, version: s.version, status: s.status, created_at: iso(s.createdAt) })
const detail = (s) => ({ id: s.id, round_id: s.roundId, version: s.version, status: s.status, created_at: iso(s.createdAt), code: s.code, blocks: s.blocks, check: s.check, server_time: iso(now()) })

function newSubmission(team, roundId, code, blocks, key) {
  // Like the backend: versions count per team, across all rounds
  const version = db.submissions.filter((s) => s.teamId === team.id).reduce((max, s) => Math.max(max, s.version), 0) + 1
  const submission = { id: db.nextSubmissionId++, key, teamId: team.id, roundId, version, status: 'pending', createdAt: now(), code, blocks, check: null }
  db.submissions.unshift(submission)
  return submission
}

/** Made-up but steady test results: one per sample bot, floats in Theatre of War. */
function finishCheck(submission, game) {
  if (db.rejectNext) {
    submission.status = 'rejected'
    submission.check = { error: db.rejectNext, test_results: [] }
    db.rejectNext = null
    return
  }
  if (!/^\s*def\s+strategy\s*\(/m.test(submission.code)) {
    submission.status = 'rejected'
    submission.check = { error: 'Line 1: Your code has no strategy function.', test_results: [] }
    return
  }
  const bots = SAMPLE_BOTS[game] ?? []
  submission.status = 'accepted'
  submission.check = {
    error: null,
    test_results: bots.map((opponent, i) => {
      const base = game === 'theatre_of_war' ? 100 : 400
      const my = base + ((submission.version * 37 + i * 53) % 200) + (game === 'theatre_of_war' ? 0.5 : 0)
      const opp = base + ((submission.version * 11 + i * 71) % 200)
      return { opponent, my_score: my, opp_score: opp }
    }),
  }
}

const bytes = (text) => Buffer.byteLength(text, 'utf8')

function submit(user, body, key) {
  if (typeof body.round_id !== 'number' || !isInt(body.round_id) || body.round_id < 1 || typeof body.code !== 'string' || !Array.isArray(body.blocks?.modules)) {
    return error(400, 'VALIDATION_ERROR', 'round_id, code and blocks.modules are required.')
  }
  if (key !== undefined && (key.length < 1 || key.length > 255)) return error(400, 'VALIDATION_ERROR', 'Idempotency-Key must be 1 to 255 characters.')
  if (user.role !== 'team') return error(403, 'FORBIDDEN', 'Only team accounts can submit.')
  const team = user.team
  if (team.id === null) return error(403, 'FORBIDDEN', 'Claim a territory before submitting.')
  if (bytes(body.code) > CODE_MAX_BYTES) return error(400, 'VALIDATION_ERROR', `Code must be at most ${CODE_MAX_BYTES} bytes.`)
  if (bytes(JSON.stringify(body.blocks)) > BLOCKS_MAX_BYTES) return error(400, 'VALIDATION_ERROR', `Blocks must be at most ${BLOCKS_MAX_BYTES} bytes.`)
  if (team.status === 'disqualified') return error(403, 'TEAM_DISQUALIFIED', 'Your team has been disqualified.')
  if (team.status === 'eliminated') return error(403, 'FORBIDDEN', 'Eliminated teams cannot submit.')
  // Before the round checks, as on the backend: a retry of a request that worked gets its answer even after the deadline
  if (key) {
    const again = db.submissions.find((s) => s.teamId === team.id && s.key === key)
    if (again) {
      const same = again.roundId === body.round_id && again.code === body.code && JSON.stringify(again.blocks) === JSON.stringify(body.blocks)
      return same ? ok(detail(again)) : error(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different body.')
    }
  }
  const round = roundById(body.round_id)
  if (!round) return error(404, 'NOT_FOUND', 'This round does not exist.')
  if (round.status !== 'open' || (round.closesAt !== null && now() > round.closesAt)) return error(409, 'ROUND_NOT_OPEN', 'This round is not open for submissions.')
  if (body.blocks.modules.length > round.config.max_modules) return error(400, 'VALIDATION_ERROR', `A submission can have at most ${round.config.max_modules} modules.`)
  const submission = newSubmission(team, round.id, body.code, body.blocks, key ?? null)
  setTimeout(() => finishCheck(submission, round.game), CHECK_MS)
  return ok(detail(submission), 202)
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

function claim(user, body) {
  if (user.role !== 'team') return error(403, 'FORBIDDEN', 'Organisers cannot claim a territory.')
  if (typeof body.territory_code !== 'string' || typeof body.nation_name !== 'string') return error(400, 'VALIDATION_ERROR', 'territory_code and nation_name are required.')
  // Like the backend: trim, collapse spaces, then check the cleaned name
  const name = body.nation_name.trim().replace(/ {2,}/g, ' ')
  if (name.length < 3 || name.length > 24) return error(400, 'VALIDATION_ERROR', 'Nation name must be 3 to 24 characters.')
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return error(400, 'VALIDATION_ERROR', 'Nation name can only use A-Z, 0-9 and spaces.')
  if (!/[A-Za-z]/.test(name)) return error(400, 'VALIDATION_ERROR', 'Nation name must contain at least one letter.')
  if (!(body.territory_code in TERRITORIES)) return error(400, 'VALIDATION_ERROR', 'Unknown territory code.')
  if (user.team.id !== null) return error(409, 'ALREADY_CLAIMED', 'You have already claimed a territory.')
  if (claimedTeams().some((t) => t.nation_name.toLowerCase() === name.toLowerCase())) return error(409, 'NAME_TAKEN', 'That nation name is already claimed.')
  if (claimedTeams().some((t) => t.territory_code === body.territory_code)) return error(409, 'TERRITORY_TAKEN', 'This territory has already been claimed.')
  claimFor(user, name, body.territory_code)
  return ok(profile(user))
}

const territoriesOut = () => ({
  territories: Object.entries(TERRITORIES).map(([code, name]) => {
    const team = claimedTeams().find((t) => t.territory_code === code)
    return { territory_code: code, name, claimed: !!team, nation_name: team?.nation_name ?? null }
  }),
})

// ---------------------------------------------------------------------------
// Rounds: the run, ranking, publish and the cut
// ---------------------------------------------------------------------------

/** The latest accepted submission created before the window closed: the one that plays. */
const playingSubmission = (teamId, round) =>
  db.submissions.find((s) => s.teamId === teamId && s.roundId === round.id && s.status === 'accepted' && (round.closesAt === null || s.createdAt <= round.closesAt))

/**
 * Rank a round like docs/api.md section 6: teams that played by score (ties by team id here,
 * standing in for head-to-head and the seeded draw), then teams with no accepted submission
 * (score 0), then teams disqualified now (score 0).
 */
function rank(entries) {
  const status = (teamId) => userOfTeam(teamId)?.team.status
  const group = (e) => (status(e.teamId) === 'disqualified' ? 2 : e.played ? 0 : 1)
  return [...entries]
    .sort((a, b) => group(a) - group(b) || (group(a) === 0 ? b.raw - a.raw : 0) || a.teamId - b.teamId)
    .map((e, i) => ({ ...e, score: group(e) === 0 ? e.raw : 0, rank: i + 1 }))
}

/** The run: every team still in the event takes part, and gets a made-up score if it has a version that plays. */
function scoreRound(round) {
  const entrants = claimedTeams().filter((t) => t.status !== 'eliminated')
  const entries = entrants.map((t) => {
    const played = !!playingSubmission(t.id, round)
    const raw = played ? ((t.id * 7919 + round.number * 104729) % 2000) + 1000 + (round.game === 'theatre_of_war' ? 0.5 : 0) : 0
    return { teamId: t.id, played, raw }
  })
  db.results[round.id] = rank(entries)
  round.status = 'review'
  round.playing = false
}

function startRun(round) {
  round.playing = true
  setTimeout(() => {
    if (round.status !== 'running') return
    if (db.failNextRun) {
      db.failNextRun = false
      round.playing = false // the round stays running; retry plays it again
      return
    }
    scoreRound(round)
  }, RUN_MS)
}

function publishRound(round) {
  round.status = 'published'
  const keep = KEEP[round.number] ?? 0
  const kept = new Set((db.results[round.id] ?? []).filter((r) => r.rank <= keep).map((r) => r.teamId))
  for (const team of claimedTeams()) if (team.status === 'active' && !kept.has(team.id)) team.status = 'eliminated'
}

/** A disqualification or restore before publish re-ranks the round's stored results. */
function rerankCurrent() {
  const round = currentRound()
  if (round && (round.status === 'running' || round.status === 'review') && db.results[round.id]) db.results[round.id] = rank(db.results[round.id])
}

function roundAction(user, action, roundId, body) {
  if (user.role !== 'organiser') return error(403, 'FORBIDDEN', 'Organisers only.')
  const needsMinutes = action === 'open' || action === 'extend'
  if (needsMinutes && (!isInt(body.minutes) || body.minutes < MIN_MINUTES || body.minutes > MAX_MINUTES)) {
    return error(400, 'VALIDATION_ERROR', `minutes must be a whole number from ${MIN_MINUTES} to ${MAX_MINUTES}.`)
  }
  const round = roundById(roundId)
  if (!round) return error(404, 'NOT_FOUND', 'This round does not exist.')
  const refuse = (why) => error(409, 'INVALID_ROUND_TRANSITION', why)
  switch (action) {
    case 'open':
      if (round.status !== 'waiting') return refuse(`Round ${round.number} is ${round.status}, not waiting.`)
      if (db.rounds.some((r) => r.number < round.number && r.status !== 'published')) return refuse('Earlier rounds must be published first.')
      openWindow(round, body.minutes)
      break
    case 'extend':
      if (round.status !== 'open') return refuse(`Round ${round.number} is ${round.status}, not open.`)
      round.closesAt += body.minutes * 60_000
      break
    case 'start':
      if (round.status !== 'open') return refuse(`Round ${round.number} is ${round.status}, not open.`)
      round.status = 'running'
      round.closesAt = now()
      startRun(round)
      break
    case 'retry':
      if (round.status !== 'running') return refuse(`Round ${round.number} is ${round.status}, not running.`)
      if (round.playing) return refuse('The matches are still being played.')
      startRun(round)
      break
    case 'publish':
      if (round.status !== 'review') return refuse(`Round ${round.number} is ${round.status}, not in review.`)
      publishRound(round)
      break
  }
  return ok(roundOut(round))
}

function setTeamStatus(user, teamId, body) {
  if (user.role !== 'organiser') return error(403, 'FORBIDDEN', 'Organisers only.')
  if (!['active', 'eliminated', 'disqualified'].includes(body.status)) return error(400, 'VALIDATION_ERROR', 'status must be active, eliminated or disqualified.')
  const owner = userOfTeam(teamId)
  if (!owner) return error(404, 'NOT_FOUND', 'This team does not exist.')
  owner.team.status = body.status
  rerankCurrent()
  return ok(profile(owner))
}

/** GET /standings: each nation's latest published result; status is always the team's status now. */
function standings() {
  const round = currentRound()
  if (!round) return error(404, 'NOT_FOUND', 'No round has started yet.')
  const published = db.rounds.filter((r) => r.status === 'published').sort((a, b) => b.number - a.number)
  const nations = []
  for (const team of claimedTeams()) {
    for (const r of published) {
      const row = db.results[r.id]?.find((e) => e.teamId === team.id)
      if (row) {
        nations.push({ team_id: team.id, nation_name: team.nation_name, territory_code: team.territory_code, status: team.status, score: row.score, rank: row.rank, roundNumber: r.number })
        break
      }
    }
  }
  nations.sort((a, b) => a.rank - b.rank || b.roundNumber - a.roundNumber || a.team_id - b.team_id)
  return ok({ round_id: round.id, round_status: round.status, nations: nations.map(({ roundNumber, ...n }) => n), server_time: iso(now()) })
}

function overview(user) {
  if (user.role !== 'organiser') return error(403, 'FORBIDDEN', 'Organisers only.')
  const round = currentRound() ?? db.rounds[0]
  if (!round) return error(404, 'NOT_FOUND', 'No rounds have been created yet.')
  const teams = claimedUsers()
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(({ username, team }) => {
      const latest = db.submissions.find((s) => s.teamId === team.id && s.roundId === round.id)
      const results = latest?.check?.test_results ?? []
      return {
        team_id: team.id,
        username,
        nation_name: team.nation_name,
        territory_code: team.territory_code,
        status: team.status,
        is_bot: false,
        submission: latest
          ? { version: latest.version, status: latest.status, passed: results.filter((r) => r.my_score >= r.opp_score).length, total: results.length, submitted_at: iso(latest.createdAt) }
          : null,
        score: db.results[round.id]?.find((e) => e.teamId === team.id)?.score ?? 0,
      }
    })
  const unclaimed = teamAccounts().filter((u) => u.team.id === null).map((u) => u.username).sort()
  const { config, server_time, ...roundFields } = roundOut(round)
  return ok({ round: roundFields, teams, unclaimed, server_time: iso(now()) })
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Every contract route: [method, path pattern, needs a login, handler(user, match, body, query, req)]. */
const ROUTES = [
  ['GET', /^\/health$/, false, () => ok({ status: 'ok' })],
  ['GET', /^\/territories$/, false, () => ok(territoriesOut())],
  ['GET', /^\/standings$/, false, () => standings()],
  ['GET', /^\/rounds\/current$/, false, () => {
    const round = currentRound()
    return round ? ok(roundOut(round)) : error(404, 'NOT_FOUND', 'No round has started yet.')
  }],
  ['GET', /^\/rounds$/, true, () => ok({ rounds: db.rounds.map(roundOut), server_time: iso(now()) })],
  ['GET', /^\/me$/, true, (user) => ok(profile(user))],
  ['POST', /^\/teams\/claim$/, true, (user, _m, body) => claim(user, body)],
  ['POST', /^\/submissions$/, true, (user, _m, body, _q, req) => submit(user, body, req.headers['idempotency-key'])],
  ['GET', /^\/submissions$/, true, (user, _m, _b, query) => {
    const roundId = Number(query.get('round_id'))
    if (!query.has('round_id') || !isInt(roundId) || roundId < 1) return error(400, 'VALIDATION_ERROR', 'round_id is required.')
    const mine = user.team?.id ? db.submissions.filter((s) => s.teamId === user.team.id && s.roundId === roundId) : []
    return ok({ submissions: mine.map(summary), server_time: iso(now()) })
  }],
  ['GET', /^\/submissions\/(\d+)$/, true, (user, m) => {
    const s = db.submissions.find((x) => x.id === Number(m[1]))
    const visible = s && (user.role === 'organiser' || (user.team?.id !== null && s.teamId === user.team?.id))
    return visible ? ok(detail(s)) : error(404, 'NOT_FOUND', 'This submission does not exist.')
  }],
  ['POST', /^\/admin\/rounds\/(\d+)\/(open|extend|start|retry|publish)$/, true, (user, m, body) => roundAction(user, m[2], Number(m[1]), body)],
  ['PATCH', /^\/admin\/teams\/(\d+)$/, true, (user, m, body) => setTeamStatus(user, Number(m[1]), body)],
  ['GET', /^\/admin\/overview$/, true, (user) => overview(user)],
]

function login(body) {
  if (typeof body.username !== 'string' || typeof body.password !== 'string') return error(400, 'VALIDATION_ERROR', 'username and password are required.')
  const user = db.users[body.username.toLowerCase()] // usernames are case-insensitive
  if (!user || body.password !== PASSWORD) return error(401, 'INVALID_CREDENTIALS', 'Wrong username or password.')
  const token = randomUUID()
  db.tokens.set(token, user.username)
  return ok({ access_token: token, token_type: 'bearer', role: user.role, team_id: user.team?.id ?? null })
}

function route(req, path, body, query) {
  if (path === '/auth/login') return req.method === 'POST' ? login(body) : error(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const matching = ROUTES.filter(([, pattern]) => pattern.test(path))
  if (matching.length === 0) return error(404, 'NOT_FOUND', `The mock has no ${req.method} ${path}`)
  const found = matching.find(([method]) => method === req.method)
  if (!found) return error(405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${path}.`)
  const [, pattern, needsLogin, handle] = found
  let user = null
  // A public route ignores the Authorization header entirely, so a stale token is never a 401 there
  if (needsLogin) {
    const username = db.tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))
    if (!username) return error(401, 'UNAUTHENTICATED', 'Log in first.')
    user = db.users[username]
  }
  return handle(user, path.match(pattern), body, query, req)
}

/** Test and demo controls. Not part of the contract. */
function control(path, body) {
  switch (path) {
    case '/__mock/reset': reset(); return {}
    case '/__mock/demo': seedDemo(!!body.publish); return {}
    /** Make round `index` open with a fresh window, every earlier round published, every later one waiting. 0: no round started yet. */
    case '/__mock/goto':
      for (const r of db.rounds) {
        if (r.number < body.index) Object.assign(r, { status: 'published', opensAt: r.opensAt ?? now(), closesAt: r.closesAt ?? now() })
        else if (r.number === body.index) openWindow(r, DEFAULT_WINDOW_MINUTES)
        else Object.assign(r, { status: 'waiting', opensAt: null, closesAt: null })
      }
      return currentRound() ? roundOut(currentRound()) : {}
    /** Change the current round directly (no transition rules): status, config, closes_in seconds. */
    case '/__mock/round': {
      const round = currentRound() ?? db.rounds[0]
      const { closes_in: closesIn, config, ...change } = body
      Object.assign(round, change)
      if (config) Object.assign(round.config, config)
      if (closesIn !== undefined) round.closesAt = closesIn === null ? null : now() + closesIn * 1000
      return roundOut(round)
    }
    /** Another team claims a territory. */
    case '/__mock/take': {
      if (claimedTeams().some((t) => t.territory_code === body.code)) return {}
      const user = addUser(`taker_${body.code.toLowerCase()}`, 'team')
      claimFor(user, `Taker ${body.code}`, body.code)
      return {}
    }
    case '/__mock/team': Object.assign(db.users[body.username].team, body.change); rerankCurrent(); return {}
    case '/__mock/fail': db.fail = body; return {}
    case '/__mock/reject': db.rejectNext = body.message; return {}
    case '/__mock/failrun': db.failNextRun = true; return {}
    case '/__mock/submissions': return db.submissions
    case '/__mock/expire': db.tokens.clear(); return {}
    default: return null
  }
}

reset()

const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const url = new URL(req.url, 'http://mock')
    const path = url.pathname
    // The page and the backend are on different ports, so the browser needs these, as the real backend sends
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
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      if (!path.startsWith('/__mock/')) return send(400, { error: { code: 'VALIDATION_ERROR', message: 'The body is not valid JSON.' } })
    }
    if (body === null || typeof body !== 'object') body = {}
    if (path.startsWith('/__mock/')) return send(200, control(path, body))
    if (db.fail[path]) {
      res.writeHead(db.fail[path], { 'Content-Type': 'text/html' })
      return res.end('<html>Bad gateway</html>')
    }
    const { status, body: answer } = route(req, path, body, url.searchParams)
    send(status, answer)
  })
})

server.listen(PORT, () => console.log(`Mock backend (docs/api.md v5.3) on http://localhost:${PORT}: team1, team2 or admin, password "${PASSWORD}"${DEMO ? `, demo teams on (${DEMO})` : ''}`))
