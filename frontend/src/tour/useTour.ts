/**
 * The hook a screen calls with its name and a "ready" flag. The screen's tour starts by itself the
 * first time it is shown on this browser, once the screen is ready and nothing else owns it.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { stepsFor, type TourContext, type TourScreen } from './steps'
import { activeTour, clearCurrentScreen, currentScreen, isAutomated, readTourState, runTour, screenBusy, setCurrentScreen, shouldAutoStart, stopTour, subscribeTour } from './tour'

/** How often to look again while the round intro, a dialog or loading is in the way. */
const CHECK_MS = 400
/** The screen must stay idle this long before the tour starts, so it never starts mid-change. */
const SETTLE_MS = 600

export function useTour(screen: TourScreen, ready: boolean, ctx: TourContext): void {
  const { role, game, mode } = ctx

  // The top bar's Tour button replays whichever screen is shown
  useEffect(() => {
    setCurrentScreen(screen, { role, game, mode })
    return () => clearCurrentScreen(screen)
  }, [screen, role, game, mode])

  // A tour whose screen goes away (sign out, view change) stops with it
  useEffect(() => () => {
    if (activeTour() === screen) stopTour()
  }, [screen])

  useEffect(() => {
    if (!ready) return
    const context = { role, game, mode }
    if (!shouldAutoStart({ screen, ctx: context, stored: readTourState(screen), automated: isAutomated() })) return
    let idleSince: number | null = null
    const timer = window.setInterval(() => {
      if (screenBusy() || activeTour() !== null) {
        idleSince = null
        return
      }
      idleSince ??= Date.now()
      if (Date.now() - idleSince < SETTLE_MS) return
      window.clearInterval(timer)
      void runTour(screen, context)
    }, CHECK_MS)
    return () => window.clearInterval(timer)
  }, [screen, ready, role, game, mode])
}

/** Replay the screen shown now, from the Tour button or the login screen's "Show me around" link. */
export function replayTour(): void {
  const shown = currentScreen()
  if (shown) void runTour(shown.screen, shown.ctx)
}

/** Whether there is a tour to replay right now, and whether one is running. */
export function useTourStatus(): { canReplay: boolean; running: boolean } {
  const shown = useSyncExternalStore(subscribeTour, currentScreen)
  const running = useSyncExternalStore(subscribeTour, activeTour)
  return { canReplay: shown !== null && running === null && stepsFor(shown.screen, shown.ctx).length > 0, running: running !== null }
}
