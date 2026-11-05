/**
 * What the server sends, as written in docs/api.md. Every answer is checked
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

export const Team = z.object({
  id: z.number(),
  nation_name: z.string().nullable(),
  territory_code: z.string().nullable(),
  status: z.string().default('alive'),
})
export type Team = z.infer<typeof Team>

export const LoginOut = z.object({
  access_token: z.string().min(1),
  role: z.string(),
  team: Team.nullable(),
})

export const Territory = z.object({ code: z.string(), name: z.string(), claimed: z.boolean() })
export const Territories = z.array(Territory)

export const Round = z
  .object({
    id: z.number(),
    number: z.number(),
    name: z.string(),
    defcon: z.number(),
    status: z.string(),
    opens_at: moment,
    closes_at: moment,
    server_time: moment,
  })
  .transform(({ opens_at, closes_at, server_time, ...round }) => ({ ...round, opensAt: opens_at, closesAt: closes_at, serverTime: server_time }))
export type Round = z.infer<typeof Round>

export const Submitted = z.object({ id: z.number(), version: z.number(), status: z.string() })

export const Submission = Submitted.extend({ created_at: moment }).transform(({ created_at, ...submission }) => ({ ...submission, createdAt: created_at }))
export type Submission = z.infer<typeof Submission>
export const Submissions = z.array(Submission)

export const SubmissionDetail = Submitted.extend({
  errors: z.array(z.string()).default([]),
  test_results: z.array(z.object({ opponent: z.string(), my_score: z.number(), opp_score: z.number() })).default([]),
})
export type SubmissionDetail = z.infer<typeof SubmissionDetail>
