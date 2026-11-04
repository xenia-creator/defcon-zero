/**
 * Typed API client generated from the server's OpenAPI schema (npm run gen:api).
 *
 * Adds the access token, refreshes it once on a 401, and fails over between
 * server nodes: VITE_API_NODES="http://node1:8000,http://node2:8000". With no
 * nodes configured, requests go to the page's own origin.
 */
import createClient from 'openapi-fetch'
import { useAuth } from './auth'
import type { components, paths } from './schema'

export type Schemas = components['schemas']

// A hung server must not leave a button stuck on "Transmitting…"
const REQUEST_TIMEOUT_MS = 30_000

const NODES: string[] = (import.meta.env.VITE_API_NODES ?? '')
  .split(',')
  .map((s: string) => s.trim().replace(/\/$/, ''))
  .filter(Boolean)
let activeNode = 0

const pageOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
export const apiOrigin = () => NODES[activeNode] ?? pageOrigin

function onNode(request: Request): Request {
  if (!NODES.length) return request
  const url = new URL(request.url)
  const target = new URL(apiOrigin())
  url.protocol = target.protocol
  url.host = target.host
  return new Request(url, request)
}

/** Send to the active node; on a network failure, switch to the next node and retry. */
async function failoverFetch(request: Request): Promise<Response> {
  const attempts = Math.max(1, NODES.length)
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(onNode(request.clone()), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (error) {
      lastError = error
      if (NODES.length > 1) activeNode = (activeNode + 1) % NODES.length
    }
  }
  throw lastError
}

let refreshing: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  const session = useAuth.getState().session
  if (!session) return false
  refreshing ??= (async () => {
    try {
      const response = await failoverFetch(
        new Request(`${pageOrigin}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh }),
        }),
      )
      // Only a refusal ends the session; a restarting server must not log the whole lab out
      if (response.status === 401 || response.status === 403) {
        useAuth.getState().logout(true)
        return false
      }
      if (!response.ok) return false
      const pair = (await response.json()) as Schemas['TokenPair']
      // The team may have logged out while this was in flight
      if (useAuth.getState().session?.refresh !== session.refresh) return false
      useAuth.getState().setSession({ access: pair.access_token, refresh: pair.refresh_token, user: pair.user })
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export const accessToken = () => useAuth.getState().session?.access

async function authedFetch(input: Request): Promise<Response> {
  const withToken = () => {
    const request = input.clone()
    const token = accessToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  }
  const response = await failoverFetch(withToken())
  if (response.status === 401 && !input.url.includes('/auth/') && (await refreshTokens())) {
    return failoverFetch(withToken())
  }
  return response
}

export const api = createClient<paths>({ baseUrl: pageOrigin, fetch: authedFetch })

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** The text to show for a failed request: the server's own message, or the fallback when it can't be reached. */
export const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Return the data or throw an ApiError carrying the server's stable error code. */
export function unwrap<T>(result: Result<T>): T {
  if (result.error !== undefined || result.data === undefined) {
    // A proxy can answer with HTML or plain text, so nothing about the body is assumed
    const body = result.error as { error?: { code?: string; message?: string; details?: Record<string, unknown> | null } } | null
    const e = body?.error
    throw new ApiError(e?.code ?? 'UNKNOWN', e?.message ?? 'Could not reach the server. Try again in a moment.', result.response.status, e?.details ?? {})
  }
  return result.data
}

export function wsUrl(path: string): string {
  const url = new URL(path, apiOrigin())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

/** Called when a WebSocket is refused; switches node so the next attempt tries elsewhere. */
export function nextNode() {
  if (NODES.length > 1) activeNode = (activeNode + 1) % NODES.length
}

export { refreshTokens }
