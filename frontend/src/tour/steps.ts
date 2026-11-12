/**
 * The app tour's steps, as data (frontend/docs/BLOCKS.md part 3.3). Each step points at a
 * `data-tour` marker. A step whose marker isn't on screen is left out when the tour starts.
 */

export type TourScreen = 'login' | 'claim' | 'workspace' | 'warmap' | 'command'

/** Who is looking and what they see: decides which screens and steps apply. */
export type TourContext = {
  /** null on the login screen, before anyone signs in. */
  role: string | null
  /** The current round's game, where the screen has one. */
  game?: string
  /** How the workspace is building: blocks, code, or the Round 2 troop map. */
  mode?: 'blocks' | 'code' | 'map'
}

export type TourStep = {
  target: string
  text: string
  /** Shown only when this is true. Every other step always applies. */
  when?: (ctx: TourContext) => boolean
}

export const TOUR_STEPS: Record<TourScreen, TourStep[]> = {
  login: [
    { target: 'login-fields', text: 'Sign in with the username and password the organisers gave your team.' },
    { target: 'login-submit', text: 'Request Clearance signs you in. Your team picks its nation next.' },
    { target: 'login-bigboard', text: 'Just watching? The Big Board shows the live war map without signing in.' },
  ],
  claim: [
    { target: 'claim-form', text: "Name your nation here. Names are unique, and you can't change it later." },
    { target: 'claim-list', text: 'Pick a free territory from the list, or search for one.' },
    { target: 'claim-submit', text: "Claim it when you're sure. The choice is final for the whole event." },
  ],
  workspace: [
    { target: 'topbar-clock', text: 'The round and its countdown. When the window closes, your latest accepted version plays.' },
    {
      target: 'play-mode',
      text: 'Choose how to build: blocks or code (in Round 2, the troop map or code). Whichever tab is open is what you submit.',
    },
    {
      target: 'examples',
      text: 'Stuck? Start from this loads a ready-made strategy for you to change. Bots built from the same example score about the same, so make it yours.',
      when: (ctx) => ctx.game !== 'theatre_of_war',
    },
    { target: 'python', text: "The Python your blocks make. It's exactly what the server runs.", when: (ctx) => ctx.mode === 'blocks' },
    { target: 'submit', text: 'Submit sends your strategy. You can submit as often as you like while the window is open.' },
    { target: 'results', text: "Test results against sample bots land here, and every version you've sent is kept below." },
  ],
  warmap: [
    { target: 'warmap-round', text: 'The current round and DEFCON level.' },
    { target: 'warmap-map', text: 'Every claimed nation on the map, with its status.' },
    { target: 'warmap-board', text: 'Standings appear here once a round is published.' },
    { target: 'warmap-clock', text: 'Server time. Every window and countdown runs on it.' },
  ],
  command: [
    { target: 'ops-order', text: "This round's orders: its game, window times and status, stamped as it moves along." },
    { target: 'ops-controls', text: 'Round Control shows only the actions this round allows: open, extend or set the time left, start, retry or publish.' },
    { target: 'ops-timer', text: 'The window timer. Teams see the same countdown.' },
    { target: 'ops-roster', text: 'Every team and its latest submission. Check that most are accepted before you start the round.' },
    { target: 'ops-unclaimed', text: "Team accounts that haven't claimed a nation yet. Chase these before Round 1 opens." },
  ],
}

/**
 * Who a screen's tour is for. Never spectators: the Big Board runs on a projector, and a
 * popover there would be shown to the whole room.
 */
export function screenAllowed(screen: TourScreen, role: string | null): boolean {
  if (role === 'spectator') return false
  switch (screen) {
    case 'login':
      return true
    case 'claim':
    case 'workspace':
      return role === 'team'
    case 'warmap':
    case 'command':
      return role === 'organiser'
  }
}

/** The steps that apply to this screen for this person and round, before checking what is on screen. */
export function stepsFor(screen: TourScreen, ctx: TourContext): TourStep[] {
  if (!screenAllowed(screen, ctx.role)) return []
  return TOUR_STEPS[screen].filter((step) => !step.when || step.when(ctx))
}
