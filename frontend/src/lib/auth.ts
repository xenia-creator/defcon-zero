import { z } from 'zod'
import { create } from 'zustand'
import { Team } from './contract'

const StoredSession = z.object({
  access: z.string().min(1),
  username: z.string(),
  role: z.string(),
  team: Team.nullable(),
})
export type Session = z.infer<typeof StoredSession>

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
    return parsed.success ? parsed.data : null
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
