/**
 * Talks to the backend described in docs/api.md. Calls go to the page's own
 * address (the Vite server passes them on), or to VITE_API_BASE if it is set.
 */
import type { z } from 'zod'
import { useAuth } from './auth'

// A hung server must not leave a button stuck on "Transmitting…"
const REQUEST_TIMEOUT_MS = 30_000

const BASE = `${(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')}/api/v1`

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/** The text to show for a failed request: the server's own message, or the fallback when it can't be reached. */
export const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

async function send(method: string, path: string, body: unknown, extra: Record<string, string>): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = useAuth.getState().session?.access
  if (token) headers.Authorization = `Bearer ${token}`
  Object.assign(headers, extra)
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal })
  } finally {
    clearTimeout(timeout)
  }
}

/** A proxy can answer with HTML or plain text, so nothing about the body is assumed. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Send a request and check the answer against its shape. Throws an ApiError
 * carrying the server's error code, or a plain error if it can't be reached.
 */
export async function request<S extends z.ZodType>(method: string, path: string, shape: S, body?: unknown, headers: Record<string, string> = {}): Promise<z.output<S>> {
  const response = await send(method, path, body, headers)
  const json = await readJson(response)
  if (!response.ok) {
    const e = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error
    const code = typeof e?.code === 'string' ? e.code : 'UNKNOWN'
    // Only an expired or missing token ends the session; a restarting server must not log the whole lab out
    if (response.status === 401 && code !== 'INVALID_CREDENTIALS' && useAuth.getState().session) useAuth.getState().logout(true)
    throw new ApiError(code, typeof e?.message === 'string' ? e.message : 'Could not reach the server. Try again in a moment.', response.status)
  }
  const parsed = shape.safeParse(json)
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'The server sent an answer this screen could not read. Tell an organiser.', response.status)
  return parsed.data
}
