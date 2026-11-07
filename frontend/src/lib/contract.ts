/**
 * What the server sends, exactly as written in docs/api.md (v5.3). Every answer is
 * checked against these before use, so a change on the server gives a clear message
 * instead of a broken screen. Keep this file, mock/server.mjs and docs/api.md in step:
 * change one, align the others. Never add a field the contract does not have.
 */
import { z } from 'zod'
import type { GameKey } from './rounds'

// ---------------------------------------------------------------------------
// Fixed values (docs/api.md)
// ---------------------------------------------------------------------------

export const ROLES = ['team', 'organiser'] as const
export const TEAM_STATUSES = ['active', 'eliminated', 'disqualified'] as const
export const ROUND_STATUSES = ['waiting', 'open', 'running', 'review', 'published'] as const
export const GAMES = ['prisoners_dilemma', 'theatre_of_war', 'foreign_aid'] as const satisfies readonly GameKey[]
export const SUBMISSION_STATUSES = ['pending', 'running', 'accepted', 'rejected'] as const

export type Role = (typeof ROLES)[number]
export type TeamStatus = (typeof TEAM_STATUSES)[number]
export type RoundStatus = (typeof ROUND_STATUSES)[number]
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/** Section 1, error codes. Branch on these, never on the message. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'TEAM_DISQUALIFIED',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'TERRITORY_TAKEN',
  'NAME_TAKEN',
  'ALREADY_CLAIMED',
  'ROUND_NOT_OPEN',
  'INVALID_ROUND_TRANSITION',
  'IDEMPOTENCY_KEY_REUSED',
  'INTERNAL_ERROR',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

const Role = z.enum(ROLES)
const TeamStatus = z.enum(TEAM_STATUSES)
const RoundStatus = z.enum(ROUND_STATUSES)
const Game = z.enum(GAMES)
const SubmissionStatus = z.enum(SUBMISSION_STATUSES)

/** A date as text from the server, as milliseconds. Unreadable dates count as missing. */
const moment = z
  .string()
  .nullable()
  .optional()
  .transform((text) => {
    const ms = text ? Date.parse(text) : NaN
    return Number.isNaN(ms) ? null : ms
  })

// ---------------------------------------------------------------------------
// 2. Auth
// ---------------------------------------------------------------------------

/** POST /auth/login. team_id is null for organisers and for teams that have not claimed yet. */
export const LoginOut = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('bearer'),
  role: Role,
  team_id: z.number().nullable(),
})
export type LoginOut = z.infer<typeof LoginOut>

/**
 * GET /me, POST /teams/claim and PATCH /admin/teams/{id}: the same body.
 * `id` is the user's id, never the team's. The team is always `team_id`, null until claimed
 * (and always null for organisers).
 */
export const Me = z.object({
  id: z.number(),
  team_id: z.number().nullable(),
  username: z.string(),
  role: Role,
  nation_name: z.string().nullable(),
  territory_code: z.string().nullable(),
  status: TeamStatus,
})
export const Team = Me
export type Team = z.infer<typeof Me> & {
  /**
   * TEMPORARY, remove with S1 (frontend/PLAN.md). /me has no score in docs/api.md and the
   * schema above never fills this in. It exists only so Workspace.tsx keeps compiling until
   * it reads the team's own score from the public GET /standings.
   */
  score?: number | null
}

/**
 * A team that has claimed its nation. The server sends team_id: null until then, so only a
 * claimed team has an id to key drafts and submissions by, and only a claimed team gets a workspace.
 */
export type ClaimedTeam = Team & { team_id: number }
export const isClaimed = (team: Team | null | undefined): team is ClaimedTeam => !!team && team.team_id !== null

// ---------------------------------------------------------------------------
// 3. Territory claim
// ---------------------------------------------------------------------------

/** POST /teams/claim body. */
export type ClaimIn = { territory_code: string; nation_name: string }

/** GET /territories, as sent (public). */
export const TerritoryList = z.object({
  territories: z.array(
    z.object({
      territory_code: z.string(),
      name: z.string(),
      claimed: z.boolean(),
      nation_name: z.string().nullable(),
    }),
  ),
})
export type TerritoryList = z.infer<typeof TerritoryList>

/** GET /territories, for the claim screen: sorted by name. */
export const Territories = TerritoryList.transform(({ territories }) =>
  territories
    .map((t) => ({ code: t.territory_code, name: t.name, claimed: t.claimed, nationName: t.nation_name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

// ---------------------------------------------------------------------------
// 4. Rounds
// ---------------------------------------------------------------------------

const RoundConfig = z.object({
  /** Named moves. Only prisoners_dilemma has them (["C", "D"]); the other games play numbers and send []. */
  moves: z.array(z.string()),
  max_modules: z.number(),
  /** Enforced by the frontend only; the server does not count blocks. */
  block_limit: z.number(),
  rounds_per_match: z.number(),
  repetitions: z.number(),
  /** theatre_of_war only: troops to split across this many regions. */
  troops: z.number().int().positive().optional(),
  regions: z.number().int().positive().optional(),
  /** foreign_aid only: the most a sender can send, and how much it grows on arrival. */
  endowment: z.number().int().nonnegative().optional(),
  multiplier: z.number().int().positive().optional(),
})

const RoundShape = z.object({
  id: z.number(),
  /** Display only (DEFCON level). Choose the game, editor and docs from `game`. */
  number: z.number(),
  game: Game,
  status: RoundStatus,
  /** Null while waiting. */
  opens_at: moment,
  closes_at: moment,
  config: RoundConfig,
  server_time: moment,
})

const toRound = ({ opens_at, closes_at, server_time, ...round }: z.output<typeof RoundShape>) => ({
  ...round,
  opensAt: opens_at,
  closesAt: closes_at,
  serverTime: server_time,
})

/** The Round object (GET /rounds/current, and every /admin/rounds/{id}/* answer). Dates as ms. */
export const Round = RoundShape.transform(toRound)
export type Round = z.infer<typeof Round>

/** GET /rounds. */
export const Rounds = z
  .object({ rounds: z.array(RoundShape), server_time: moment })
  .transform(({ rounds, server_time }) => ({ rounds: rounds.map(toRound), serverTime: server_time }))
export type Rounds = z.infer<typeof Rounds>

/** POST /admin/rounds/{id}/open and /extend body: minutes must be 1 to 240. */
export type MinutesIn = { minutes: number }
export const MIN_WINDOW_MINUTES = 1
export const MAX_WINDOW_MINUTES = 240

// ---------------------------------------------------------------------------
// 5. Submissions
// ---------------------------------------------------------------------------

/** Limits on POST /submissions (v5): sizes in bytes, the blocks measured as JSON. */
export const CODE_MAX_BYTES = 65_536
export const BLOCKS_MAX_BYTES = 262_144

const Blocks = z.object({ modules: z.array(z.record(z.string(), z.unknown())) })

/** POST /submissions body. */
export type SubmissionIn = { round_id: number; code: string; blocks: z.infer<typeof Blocks> }

/** A version history row (GET /submissions?round_id=). */
export const Submission = z
  .object({ id: z.number(), version: z.number(), status: SubmissionStatus, created_at: moment })
  .transform(({ created_at, ...submission }) => ({ ...submission, createdAt: created_at }))
export type Submission = z.infer<typeof Submission>
export const Submissions = z
  .object({ submissions: z.array(Submission), server_time: moment })
  .transform(({ submissions }) => submissions)

/** The full Submission object (POST /submissions, GET /submissions/{id}). `check` is null until checked. */
export const SubmissionDetail = z
  .object({
    id: z.number(),
    round_id: z.number(),
    version: z.number(),
    status: SubmissionStatus,
    created_at: moment,
    code: z.string(),
    blocks: Blocks,
    check: z
      .object({
        error: z.string().nullable(),
        test_results: z.array(z.object({ opponent: z.string(), my_score: z.number(), opp_score: z.number() })),
      })
      .nullable(),
    server_time: moment,
  })
  .transform(({ check, created_at, server_time, ...submission }) => ({
    ...submission,
    createdAt: created_at,
    error: check?.error ?? null,
    tests: check?.test_results ?? [],
  }))
export type SubmissionDetail = z.infer<typeof SubmissionDetail>

/** POST /submissions answers with the same Submission object (202 new, 200 for a repeated key). */
export const Submitted = SubmissionDetail

/** A submission stays pending or running until the server has finished checking it. */
export const isChecked = (status: string) => status === 'accepted' || status === 'rejected'

// ---------------------------------------------------------------------------
// 6. Standings (public; published results only; 404 before any round has started)
// ---------------------------------------------------------------------------

export const Standings = z.object({
  /** The current round, the same one as GET /rounds/current. */
  round_id: z.number(),
  round_status: RoundStatus,
  /** Each nation's latest published result, sorted by rank. [] until the first round is published. */
  nations: z.array(
    z.object({
      team_id: z.number(),
      nation_name: z.string(),
      territory_code: z.string(),
      /** Always the team's status now. */
      status: TeamStatus,
      score: z.number(),
      rank: z.number().int(),
    }),
  ),
  server_time: z.string(),
})
export type Standings = z.infer<typeof Standings>
export type StandingsNation = Standings['nations'][number]

// ---------------------------------------------------------------------------
// 7. Admin: teams and overview (organiser only)
// ---------------------------------------------------------------------------

/** PATCH /admin/teams/{id} body. Answers with the GET /me body. */
export type TeamStatusIn = { status: TeamStatus }

export const AdminOverview = z.object({
  /** The current round, or the first round before any has started. No config, no server_time. */
  round: z.object({
    id: z.number(),
    number: z.number(),
    game: Game,
    status: RoundStatus,
    opens_at: z.string().nullable(),
    closes_at: z.string().nullable(),
  }),
  /** Every claimed team, sorted by username. */
  teams: z.array(
    z.object({
      team_id: z.number(),
      username: z.string(),
      nation_name: z.string().nullable(),
      territory_code: z.string().nullable(),
      status: TeamStatus,
      is_bot: z.literal(false),
      /** Latest submission in `round`, whatever its status. passed/total are 0 until checked. */
      submission: z
        .object({
          version: z.number(),
          status: SubmissionStatus,
          passed: z.number().int(),
          total: z.number().int(),
          submitted_at: z.string(),
        })
        .nullable(),
      /** This round's score, in every state; 0 before results. */
      score: z.number(),
    }),
  ),
  /** Usernames of team accounts that have not claimed yet, sorted. */
  unclaimed: z.array(z.string()),
  server_time: z.string(),
})
export type AdminOverview = z.infer<typeof AdminOverview>
export type AdminTeamRow = AdminOverview['teams'][number]

// ---------------------------------------------------------------------------
// 10. Health (public)
// ---------------------------------------------------------------------------

export const Health = z.object({ status: z.literal('ok') })
