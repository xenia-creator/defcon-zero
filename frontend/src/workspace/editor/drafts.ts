/**
 * Drafts are kept in IndexedDB and mirrored to localStorage, so a reload, a crash
 * or one blocked store never loses work. Whatever comes back is checked first.
 */
import { get, set } from 'idb-keyval'
import { z } from 'zod'
import { BLOCKS_MAX_BYTES, CODE_MAX_BYTES } from '../../lib/contract'
import type { Layout } from '../blocks/layout'

/** What a team builds: hand-written code that defines strategy, plus block modules. */
export type Agent = { hand_code: string; modules: Layout[] }

const AgentShape = z.object({
  hand_code: z.string(),
  modules: z.array(z.record(z.string(), z.unknown())),
})
const Stored = z.object({ agent: AgentShape, saved_at: z.number() })

/** One draft per game, so a new round never overwrites or inherits another game's code. */
const key = (teamId: number, game: string) => `draft:${teamId}:${game}`

/** An Agent from any stored form (current, older plain agent, older plain code), or null. */
export function parseAgent(value: unknown): Agent | null {
  if (typeof value === 'string') return { hand_code: value, modules: [] }
  const plain = AgentShape.safeParse(value)
  if (plain.success) return plain.data
  const stored = Stored.safeParse(value)
  return stored.success ? stored.data.agent : null
}

const savedAt = (value: unknown) => {
  const stored = Stored.safeParse(value)
  return stored.success ? stored.data.saved_at : 0
}

export function newestDraft(a: unknown, b: unknown): Agent | undefined {
  const [first, second] = savedAt(a) >= savedAt(b) ? [a, b] : [b, a]
  return parseAgent(first) ?? parseAgent(second) ?? undefined
}

function readMirror(teamId: number, game: string): unknown {
  try {
    const raw = localStorage.getItem(key(teamId, game))
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export async function loadDraft(teamId: number, game: string): Promise<Agent | undefined> {
  let stored: unknown
  try {
    stored = await get(key(teamId, game))
  } catch {
    // storage can be unavailable (private window); the mirror may still have it
  }
  return newestDraft(stored, readMirror(teamId, game))
}

/** False when neither store took it, so the screen can warn the team. Runs fully synchronously for the mirror, so it also works while the page is closing. */
export async function saveDraft(teamId: number, game: string, agent: Agent): Promise<boolean> {
  const record = { agent, saved_at: Date.now() }
  let saved = false
  try {
    localStorage.setItem(key(teamId, game), JSON.stringify(record))
    saved = true
  } catch {
    // quota or blocked; IndexedDB below may still work
  }
  try {
    await set(key(teamId, game), record)
    saved = true
  } catch {
    // the server keeps every submitted version
  }
  return saved
}

/** POST /submissions limits (docs/api.md section 5): 64 KB code, 256 KB blocks JSON, measured in UTF-8 bytes. */
export const MAX_CODE_LENGTH = CODE_MAX_BYTES
export const MAX_BLOCKS_BYTES = BLOCKS_MAX_BYTES

const encoder = new TextEncoder()
export const utf8Bytes = (text: string): number => encoder.encode(text).byteLength
export const blocksBytes = (modules: Layout[]): number => utf8Bytes(JSON.stringify({ modules }))
