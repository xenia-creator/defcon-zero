import type { Session } from '../lib/auth'

export type View = 'workspace' | 'warmap' | 'command'

export const VIEW_LABELS: Record<View, string> = { workspace: 'Workspace', warmap: 'War Map', command: 'Command Console' }

/**
 * What each role may open. This is the only gate: a view not listed here is never
 * rendered, whatever was clicked before.
 *   team       only its own workspace for the current round: no war map, no standings, no Command Console
 *   organiser  the war map with standings, and the Command Console (all admin controls live there)
 *   anyone else (the view-only "spectator" from the login page) the war map only, without standings
 */
export function viewsFor(session: Pick<Session, 'role' | 'team'>): View[] {
  if (session.role === 'organiser') return ['warmap', 'command']
  if (session.role === 'team') return session.team ? ['workspace'] : []
  return ['warmap']
}

/** The leaderboard (every team's score and rank) is for organisers only. */
export const seesStandings = (session: Pick<Session, 'role'>) => session.role === 'organiser'
