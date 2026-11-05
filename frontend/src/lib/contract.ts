/**
 * What the server sends, as written in docs/api.md (v2). Every answer is checked
 * against these before use, so a change on the server gives a clear message
 * instead of a broken screen.
 */
import { z } from 'zod'

/** A date as text from the server, as milliseconds. Unreadable dates count as missing. */
const moment = z
  .string()
  .nullable()
  .optional()
  .transform((text) => {
    const ms = text ? Date.parse(text) : NaN
    return Number.isNaN(ms) ? null : ms
  })

export const LoginOut = z.object({
  access_token: z.string().min(1),
  role: z.string(),
  team_id: z.number().nullable().optional(),
})

/** GET /me and POST /teams/claim. */
export const Team = z.object({
  id: z.number(),
  nation_name: z.string().nullable(),
  territory_code: z.string().nullable(),
  status: z.string().default('active'),
})
export type Team = z.infer<typeof Team>

/** The contract only sends codes for now, so names come from the browser unless the server adds them. */
export function territoryName(code: string, name?: string | null): string {
  if (name) return name
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export const Territories = z
  .object({
    territories: z.array(z.object({ territory_code: z.string(), name: z.string().nullable().optional(), claimed: z.boolean() })),
  })
  .transform(({ territories }) =>
    territories.map((t) => ({ code: t.territory_code, name: territoryName(t.territory_code, t.name), claimed: t.claimed })).sort((a, b) => a.name.localeCompare(b.name)),
  )

export const Round = z
  .object({
    id: z.number(),
    number: z.number(),
    game: z.string(),
    status: z.string(),
    opens_at: moment,
    closes_at: moment,
    config: z.object({
      moves: z.array(z.string()).min(1),
      max_modules: z.number(),
      block_limit: z.number(),
      rounds_per_match: z.number().optional(),
      repetitions: z.number().optional(),
    }),
    server_time: moment,
  })
  .transform(({ opens_at, closes_at, server_time, ...round }) => ({ ...round, opensAt: opens_at, closesAt: closes_at, serverTime: server_time }))
export type Round = z.infer<typeof Round>

export const Submitted = z.object({ id: z.number(), version: z.number(), status: z.string() })

export const Submission = Submitted.extend({ created_at: moment }).transform(({ created_at, ...submission }) => ({ ...submission, createdAt: created_at }))
export type Submission = z.infer<typeof Submission>
export const Submissions = z.object({ submissions: z.array(Submission) }).transform(({ submissions }) => submissions)

export const SubmissionDetail = Submitted.extend({
  code: z.string().default(''),
  blocks: z
    .object({ modules: z.array(z.record(z.string(), z.unknown())) })
    .nullable()
    .optional(),
  check: z
    .object({
      error: z.string().nullable().optional(),
      test_results: z.array(z.object({ opponent: z.string(), my_score: z.number(), opp_score: z.number() })).default([]),
    })
    .nullable()
    .optional(),
}).transform(({ check, ...submission }) => ({ ...submission, error: check?.error ?? null, tests: check?.test_results ?? [] }))
export type SubmissionDetail = z.infer<typeof SubmissionDetail>

/** A submission stays pending or running until the server has finished checking it. */
export const isChecked = (status: string) => status === 'accepted' || status === 'rejected'
