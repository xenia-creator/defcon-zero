import type { Session } from '../lib/auth'

export type View = 'workspace' | 'warmap' | 'command'

export const VIEW_LABELS: Record<View, string> = { workspace: 'Workspace', warmap: 'War Map', command: 'Command Console' }

/**
 * What each role may open. This is the only gate: a view not listed here is never
 * rendered, whatever was clicked before.
 *   team       only its own workspace, for the current round only: no war map, no standings,
 *              no Command Console. Round gating (open / closed / fallen) is inside the workspace.
 *   organiser  the war map with standings, and the Command Console (all admin controls live there)
 *   spectator  the public war map: the public round (GET /rounds/current) and the published
 *              standings (GET /standings). No login, no token.
 *   anything else gets the least: the public war map only.
 *
 * Takes any role string, so a role this client doesn't know safely gets the least.
 */
export function viewsFor(session: { role: string; team: Session['team'] }): View[] {
  if (session.role === 'organiser') return ['warmap', 'command']
  if (session.role === 'team') return session.team ? ['workspace'] : []
  return ['warmap']
}

/**
 * Whether published standings (every nation's score and rank, GET /standings) may be shown.
 * Organisers and the public board yes; teams never, as they see only their own round.
 * GET /standings only ever holds published results, so nothing private reaches a spectator.
 * How the leaderboard looks, and that it is hidden or labelled while a round runs, is the
 * war map's job (frontend/PLAN.md, N2), not this gate's.
 */
export const seesStandings = (session: { role: string }) => session.role === 'organiser' || session.role === 'spectator'
