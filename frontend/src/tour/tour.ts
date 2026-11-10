/**
 * The app tour: when it may start, what it remembers, and running it with driver.js
 * (frontend/docs/BLOCKS.md part 3.2). Everything that decides is a plain function, so it is
 * unit-tested without a browser; only runTour touches driver.js and the page.
 */
import type { Config, DriveStep, Driver, PopoverDOM } from 'driver.js'
import { stepsFor, type TourContext, type TourScreen, type TourStep } from './steps'

export type TourState = 'done' | 'skipped'

/** `v1`, so a redesign can show every tour again by moving to v2. */
export const storageKey = (screen: TourScreen) => `dz.tour.v1.${screen}`

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** What this browser remembers about a screen's tour. Storage that fails counts as never seen. */
export function readTourState(screen: TourScreen, store: KeyValueStore | null = browserStorage()): TourState | null {
  try {
    const value = store?.getItem(storageKey(screen))
    return value === 'done' || value === 'skipped' ? value : null
  } catch {
    return null
  }
}

/** Remember a finished or skipped tour. If storage fails, the tour may simply be offered again. */
export function writeTourState(screen: TourScreen, state: TourState, store: KeyValueStore | null = browserStorage()): void {
  try {
    store?.setItem(storageKey(screen), state)
  } catch {
    // Nothing breaks: the tour may be offered again next time
  }
}

/** Browser automation (Playwright, WebDriver) sets navigator.webdriver, as RoundIntro.tsx checks. */
export const isAutomated = (nav: { webdriver?: boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator) =>
  nav?.webdriver === true

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Whether a screen's tour may start by itself. A Replay click skips this check. */
export function shouldAutoStart(opts: { screen: TourScreen; ctx: TourContext; stored: TourState | null; automated: boolean }): boolean {
  if (opts.automated || opts.stored !== null) return false
  return stepsFor(opts.screen, opts.ctx).length > 0
}

/** Steps whose marker is on screen. A tour with none left doesn't start. */
export function presentSteps(steps: TourStep[], isPresent: (target: string) => boolean): TourStep[] {
  return steps.filter((step) => isPresent(step.target))
}

const selector = (target: string) => `[data-tour="${target}"]`

/** A marker counts as on screen when it exists and takes up space (not hidden or display: none). */
export function markerVisible(target: string, doc: Document = document): boolean {
  const element = doc.querySelector<HTMLElement>(selector(target))
  if (!element) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

/**
 * True while something else owns the screen: the round intro or a confirm dialog. The tour waits.
 * Loading and error states are each screen's own `ready` flag (see useTour).
 */
export function screenBusy(doc: Document = document): boolean {
  if (doc.querySelector('[data-testid="round-intro"]')) return true
  return Array.from(doc.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((el) => !el.closest('.driver-popover'))
}

/** The driver.js options every tour uses. Under reduced motion, popovers appear in place and the page jumps. */
export function driverOptions(reducedMotion: boolean): Config {
  return {
    animate: !reducedMotion,
    smoothScroll: !reducedMotion,
    // The page underneath is shown, never used: a click can't open a round, claim a nation or submit
    disableActiveInteraction: true,
    overlayClickBehavior: 'none',
    allowClose: true, // Esc skips
    allowKeyboardControl: true,
    overlayColor: '#0e1011',
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 0,
    popoverClass: 'dz-tour',
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    showButtons: ['previous', 'next'],
    prevBtnText: 'Back',
    nextBtnText: 'Next',
    doneBtnText: 'Done',
  }
}

// ---- which tour is running, for the Replay button and the blocks tutorial ----

let active: TourScreen | null = null
let current: { screen: TourScreen; ctx: TourContext } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** Re-render when a tour starts or ends, or the screen shown changes. */
export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const activeTour = () => active

/** The screen shown now, so the top bar's Tour button replays the right one. */
export function setCurrentScreen(screen: TourScreen, ctx: TourContext): void {
  current = { screen, ctx }
  notify()
}

export function clearCurrentScreen(screen: TourScreen): void {
  if (current?.screen === screen) current = null
  notify()
}

export const currentScreen = () => current

/**
 * Whether the screen's own tour no longer stands in the way, so the blocks tutorial may start:
 * it isn't running, and it has been finished or skipped, can't auto-start here, or isn't for this person.
 */
export function tourSettled(screen: TourScreen, ctx: TourContext): boolean {
  if (active !== null) return false
  return !shouldAutoStart({ screen, ctx, stored: readTourState(screen), automated: isAutomated() })
}

let running: Driver | null = null
/** Ends the running tour's bookkeeping: what it remembers, the running flag and focus. */
let endRunning: ((state: TourState) => void) | null = null

/**
 * Run a screen's tour now. Returns false when nothing applies (no steps on screen, or a tour
 * is already running). Remembers it as done or skipped when it ends.
 *
 * The end is handled here, not in driver.js's onDestroyed: driver.js only records the current
 * step once its slide animation finishes, and closing before that skips onDestroyed. A quick
 * Next, Done or Skip would then be forgotten and leave the tour marked as running.
 */
export async function runTour(screen: TourScreen, ctx: TourContext): Promise<boolean> {
  if (active !== null) return false
  const steps = presentSteps(stepsFor(screen, ctx), (target) => markerVisible(target))
  if (steps.length === 0) return false

  active = screen
  notify()
  // Loaded only when a tour runs, so the app's first screen stays light
  const [{ driver }] = await Promise.all([import('driver.js'), import('driver.js/dist/driver.css'), import('./tour.css')])
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const narrow = window.matchMedia?.('(max-width: 640px)').matches ?? false

  const driveSteps: DriveStep[] = steps.map((step) => ({
    element: selector(step.target),
    popover: { description: step.text, ...(narrow ? { side: 'bottom' as const, align: 'start' as const } : {}) },
  }))

  let ended = false
  const end = (state: TourState) => {
    if (ended) return
    ended = true
    writeTourState(screen, state)
    running = null
    endRunning = null
    active = null
    notify()
    returnFocus?.focus({ preventScroll: true })
  }
  /** Close for good: the bookkeeping first, then driver.js's own teardown. */
  const finish = (state: TourState) => {
    end(state)
    tour.destroy()
  }

  const tour = driver({
    ...driverOptions(prefersReducedMotion()),
    steps: driveSteps,
    onPopoverRender: (popover) => decorate(popover, () => finish('skipped')),
    // Next on the last step is Done
    onNextClick: () => (tour.isLastStep() ? finish('done') : tour.moveNext()),
    // Esc (and any other close driver.js starts) comes through here; overlay clicks are off
    onDestroyStarted: (_element, _step, { reason }) => finish(reason === 'done' ? 'done' : 'skipped'),
    // A teardown from elsewhere still clears the running flag
    onDestroyed: () => end('skipped'),
  })
  running = tour
  endRunning = end
  tour.drive()
  return true
}

/** Stop a running tour, for example when the screen it was on goes away. Counts as skipped. */
export function stopTour(): void {
  endRunning?.('skipped')
  running?.destroy()
}

let titleId = 0

/**
 * The popover as the app needs it: a dialog with a live step region, and a "Skip tour" text
 * button in place of driver.js's ×, so the word Skip is always on screen. Focus moves inside.
 */
function decorate(popover: PopoverDOM, skip: () => void): void {
  const id = `dz-tour-step-${++titleId}`
  popover.wrapper.setAttribute('role', 'dialog')
  popover.wrapper.setAttribute('aria-modal', 'false')
  popover.description.id = id
  popover.wrapper.setAttribute('aria-labelledby', id)
  popover.description.setAttribute('aria-live', 'polite')
  popover.closeButton.remove()

  const skipButton = document.createElement('button')
  skipButton.type = 'button'
  skipButton.className = 'dz-tour-skip'
  skipButton.textContent = 'Skip tour'
  skipButton.addEventListener('click', skip)
  popover.footer.prepend(skipButton)

  queueMicrotask(() => popover.nextButton.focus({ preventScroll: true }))
}
