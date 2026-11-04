import { z } from 'zod'
import { create } from 'zustand'
import type { Schemas } from './api'

type Session = { access: string; refresh: string; user: Schemas['UserOut'] }

type AuthState = {
  session: Session | null
  /** The server refused the refresh token, so the login screen says why. */
  expired: boolean
  setSession: (session: Session) => void
  setUser: (user: Schemas['UserOut']) => void
  logout: (expired?: boolean) => void
}

const KEY = 'ic.session'

const StoredSession = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  user: z.object({
    id: z.string(),
    username: z.string(),
    role: z.string(),
    team: z
      .object({
        id: z.string(),
        name: z.string(),
        country_code: z.string().nullable(),
        eliminated_in: z.number().nullable(),
      })
      .nullable(),
  }),
})

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
  setUser: (user) => {
    const current = get().session
    if (!current) return
    const session = { ...current, user }
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
