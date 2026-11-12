// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { screenAllowed, stepsFor, TOUR_STEPS, type TourScreen } from './steps'
import { driverOptions, presentSteps, readTourState, screenBusy, shouldAutoStart, storageKey, writeTourState } from './tour'

const targets = (screen: TourScreen, ctx: Parameters<typeof stepsFor>[1]) => stepsFor(screen, ctx).map((s) => s.target)

describe('who sees which tour', () => {
  it('login is for anyone, before or after sign-in, except a spectator', () => {
    expect(screenAllowed('login', null)).toBe(true)
    expect(screenAllowed('login', 'team')).toBe(true)
    expect(screenAllowed('login', 'organiser')).toBe(true)
    expect(screenAllowed('login', 'spectator')).toBe(false)
  })

  it('claim and workspace are for teams only', () => {
    for (const screen of ['claim', 'workspace'] as const) {
      expect([screenAllowed(screen, 'team'), screenAllowed(screen, 'organiser'), screenAllowed(screen, 'spectator'), screenAllowed(screen, null)]).toEqual([true, false, false, false])
    }
  })

  it('the war map and Command Console are for organisers only, never the projector', () => {
    for (const screen of ['warmap', 'command'] as const) {
      expect([screenAllowed(screen, 'organiser'), screenAllowed(screen, 'team'), screenAllowed(screen, 'spectator'), screenAllowed(screen, null)]).toEqual([true, false, false, false])
    }
  })

  it('a role this client does not know gets no tours beyond login', () => {
    expect((['claim', 'workspace', 'warmap', 'command'] as const).map((s) => screenAllowed(s, 'judge'))).toEqual([false, false, false, false])
  })

  it('a spectator gets no steps on any screen', () => {
    for (const screen of Object.keys(TOUR_STEPS) as TourScreen[]) expect(stepsFor(screen, { role: 'spectator' })).toEqual([])
  })
})

describe('which steps show', () => {
  it('login has its three steps, claim three (no map step), organisers four and five', () => {
    expect(targets('login', { role: null })).toEqual(['login-fields', 'login-submit', 'login-bigboard'])
    expect(targets('claim', { role: 'team' })).toEqual(['claim-form', 'claim-list', 'claim-submit'])
    expect(targets('warmap', { role: 'organiser' })).toEqual(['warmap-round', 'warmap-map', 'warmap-board', 'warmap-clock'])
    expect(targets('command', { role: 'organiser' })).toEqual(['ops-order', 'ops-controls', 'ops-timer', 'ops-roster', 'ops-unclaimed'])
  })

  it('workspace in Round 1 blocks mode has all six steps', () => {
    expect(targets('workspace', { role: 'team', game: 'prisoners_dilemma', mode: 'blocks' })).toEqual(['topbar-clock', 'play-mode', 'examples', 'python', 'submit', 'results'])
  })

  it('workspace in Round 3 code mode leaves out the Python panel', () => {
    expect(targets('workspace', { role: 'team', game: 'foreign_aid', mode: 'code' })).toEqual(['topbar-clock', 'play-mode', 'examples', 'submit', 'results'])
  })

  it('workspace in Round 2 leaves out Start from this and the Python panel', () => {
    expect(targets('workspace', { role: 'team', game: 'theatre_of_war', mode: 'map' })).toEqual(['topbar-clock', 'play-mode', 'submit', 'results'])
    expect(targets('workspace', { role: 'team', game: 'theatre_of_war', mode: 'code' })).toEqual(['topbar-clock', 'play-mode', 'submit', 'results'])
  })

  it('a step whose marker is not on screen is left out', () => {
    const steps = stepsFor('workspace', { role: 'team', game: 'prisoners_dilemma', mode: 'blocks' })
    expect(presentSteps(steps, (t) => t !== 'examples' && t !== 'submit').map((s) => s.target)).toEqual(['topbar-clock', 'play-mode', 'python', 'results'])
    expect(presentSteps(steps, () => false)).toEqual([])
  })

  it('every step has text', () => {
    for (const steps of Object.values(TOUR_STEPS)) for (const step of steps) expect(step.text.length).toBeGreaterThan(10)
  })
})

describe('remembered per browser', () => {
  afterEach(() => localStorage.clear())

  it('stores done or skipped under dz.tour.v1.<screen>', () => {
    expect(storageKey('workspace')).toBe('dz.tour.v1.workspace')
    expect(readTourState('workspace')).toBeNull()
    writeTourState('workspace', 'skipped')
    expect(localStorage.getItem('dz.tour.v1.workspace')).toBe('skipped')
    expect(readTourState('workspace')).toBe('skipped')
    writeTourState('workspace', 'done')
    expect(readTourState('workspace')).toBe('done')
  })

  it('ignores anything else stored there', () => {
    localStorage.setItem('dz.tour.v1.claim', 'maybe')
    expect(readTourState('claim')).toBeNull()
  })

  it('storage that throws counts as never seen, and writing never throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readTourState('login', broken)).toBeNull()
    expect(() => writeTourState('login', 'done', broken)).not.toThrow()
    expect(readTourState('login', null)).toBeNull()
  })
})

describe('starting by itself', () => {
  const team = { role: 'team', game: 'prisoners_dilemma', mode: 'blocks' as const }

  it('starts the first time, for someone it is meant for', () => {
    expect(shouldAutoStart({ screen: 'workspace', ctx: team, stored: null, automated: false })).toBe(true)
  })

  it('never under browser automation, even the first time', () => {
    expect(shouldAutoStart({ screen: 'workspace', ctx: team, stored: null, automated: true })).toBe(false)
  })

  it('never again once done or skipped', () => {
    expect(shouldAutoStart({ screen: 'workspace', ctx: team, stored: 'done', automated: false })).toBe(false)
    expect(shouldAutoStart({ screen: 'workspace', ctx: team, stored: 'skipped', automated: false })).toBe(false)
  })

  it('never for someone the screen is not meant for', () => {
    expect(shouldAutoStart({ screen: 'warmap', ctx: { role: 'spectator' }, stored: null, automated: false })).toBe(false)
    expect(shouldAutoStart({ screen: 'command', ctx: { role: 'team' }, stored: null, automated: false })).toBe(false)
  })
})

describe('waiting for the screen to be free', () => {
  afterEach(() => (document.body.innerHTML = ''))

  it('is free when nothing else is up', () => {
    document.body.innerHTML = '<main><button data-tour="submit">Submit</button></main>'
    expect(screenBusy()).toBe(false)
  })

  it('waits for the round intro', () => {
    document.body.innerHTML = '<div data-testid="round-intro" role="status"></div>'
    expect(screenBusy()).toBe(true)
  })

  it('waits for the winner flash', () => {
    document.body.innerHTML = '<div data-testid="winner-flash" role="status"></div>'
    expect(screenBusy()).toBe(true)
  })

  it('waits for a confirm dialog, but not for its own popover or a non-modal card', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true">Lock in?</div>'
    expect(screenBusy()).toBe(true)
    document.body.innerHTML = '<div class="driver-popover"><div role="dialog" aria-modal="true"></div></div><div role="dialog" aria-modal="false"></div>'
    expect(screenBusy()).toBe(false)
  })
})

describe('driver.js options', () => {
  it('blocks the page, lets Esc and arrows work, and labels the buttons', () => {
    const options = driverOptions(false)
    expect(options).toMatchObject({
      disableActiveInteraction: true,
      overlayClickBehavior: 'none',
      allowClose: true,
      allowKeyboardControl: true,
      popoverClass: 'dz-tour',
      prevBtnText: 'Back',
      nextBtnText: 'Next',
      doneBtnText: 'Done',
    })
  })

  it('animates normally, and appears in place under reduced motion', () => {
    expect(driverOptions(false)).toMatchObject({ animate: true, smoothScroll: true })
    expect(driverOptions(true)).toMatchObject({ animate: false, smoothScroll: false })
  })
})
