import { z } from 'zod'
import { create } from 'zustand'
import { ROLES, Team } from './contract'

/**
 * Who is using this browser. `team` and `organiser` come from POST /auth/login.
 * `spectator` is local only: the view-only big board from the login page. It never
 * signs in, so it has no token and only ever calls the public routes
 * (GET /standings, GET /territories, GET /health).
 */
export const SESSION_ROLES = [...ROLES, 'spectator'] as const
export type SessionRole = (typeof SESSION_ROLES)[number]

const StoredSession = z.object({
  /** The bearer token. Ignored (never sent) for a spectator. */
  access: z.string(),
  username: z.string(),
  role: z.enum(SESSION_ROLES),
  team: Team.nullable(),
})
export type Session = z.infer<typeof StoredSession>

/** The view-only big board. No token, no team. */
export const SPECTATOR_SESSION: Session = { access: '', username: 'spectator', role: 'spectator', team: null }

export const isSpectator = (session: Pick<Session, 'role'> | null | undefined) => session?.role === 'spectator'

/** The bearer token to send, or null: a spectator never sends one, even if an old session stored a placeholder. */
export const tokenOf = (session: Session | null | undefined) => (session && !isSpectator(session) && session.access ? session.access : null)

type AuthState = {
  session: Session | null
  /** The server refused the token, so the login screen says why. */
  expired: boolean
  setSession: (session: Session) => void
  setTeam: (team: Team) => void
  logout: (expired?: boolean) => void
}

const KEY = 'ic.session'

/** Anything else in storage (edited by hand, an old version) just means logging in again. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const parsed = StoredSession.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    // Only a spectator may be without a token
    if (!isSpectator(parsed.data) && !parsed.data.access) return null
    return parsed.data
  } catch {
    return null
  }
}

function load(): Session | null {
  try {
    return parseSession(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

function save(session: Session | null) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // storage may be blocked; the session then lasts until reload
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  session: load(),
  expired: false,
  setSession: (session) => {
    save(session)
    set({ session, expired: false })
  },
  setTeam: (team) => {
    const current = get().session
    if (!current) return
    const session = { ...current, team }
    save(session)
    set({ session })
  },
  logout: (expired = false) => {
    save(null)
    set({ session: null, expired })
  },
}))

// A login or logout in another tab applies here too
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) useAuth.setState({ session: parseSession(event.newValue) })
  })
}
