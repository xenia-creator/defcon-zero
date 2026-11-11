import { useCallback, useEffect, useRef, useState } from 'react'
import type { Round } from '../lib/contract'
import { introToPlay, roundByGame, type RoundInfo } from '../lib/rounds'

/**
 * Timeline: the entrance settles by ~1.35s (stamp down), then holds still ~2.5s so the scene and
 * title can be taken in, then at HOLD_MS the whole card rushes the viewer for ZOOM_MS
 * (index.css, round-intro-rush): ~4.5s in all.
 * Under reduced motion there is no zoom, only a short fade (CLEAR_MS).
 */
const HOLD_MS = 3_850
const ZOOM_MS = 650
const CLEAR_MS = 200

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
/** A slow image never holds the intro back longer than this; it then plays over the dark backdrop. */
const IMAGE_WAIT_MS = 1_500

const seenKey = (roundId: number) => `dz.intro.${roundId}`
// Used when localStorage is blocked (private window), so the intro still plays only once per page load
const seenInMemory = new Set<number>()

function seen(roundId: number) {
  if (seenInMemory.has(roundId)) return true
  try {
    return localStorage.getItem(seenKey(roundId)) !== null
  } catch {
    return false
  }
}

function markSeen(roundId: number) {
  seenInMemory.add(roundId)
  try {
    localStorage.setItem(seenKey(roundId), '1')
  } catch {
    // memory is enough
  }
}

/** Stamp ink per DEFCON level, as on the header badge (ui.tsx). */
const STAMP_INK: Record<RoundInfo['defcon'], string> = { 3: 'text-amber', 2: 'text-fire', 1: 'text-alert' }

/**
 * Browser automation (Playwright, WebDriver) sets navigator.webdriver. The intro is skipped there so
 * it never covers the screen under an e2e test; real users always get it.
 */
const AUTOMATED = typeof navigator !== 'undefined' && navigator.webdriver === true

/**
 * The round-intro splash: when a round opens, its scene fills the screen with the round's
 * name, game and DEFCON level, holds, then rushes toward the viewer and is gone (~4.5s in all),
 * or sooner on a click (never on a key).
 * Plays once per round per browser (lib/rounds.ts, introToPlay), latecomers included.
 * `enabled` is false where it would get in the way (the Command Console); it then waits
 * until the viewer is somewhere it may play.
 */
export function RoundIntro(props: { round: Round | null | undefined; enabled: boolean }) {
  // AUTOMATED never changes during a page's life, so this never switches hooks on or off
  return AUTOMATED ? null : <Splash {...props} />
}

function Splash({ round, enabled }: { round: Round | null | undefined; enabled: boolean }) {
  const [playing, setPlaying] = useState<RoundInfo | null>(null)
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<number | null>(null)

  // Fetch the scene as soon as the round is known, so the intro rarely waits for it
  const scene = roundByGame(round?.game)?.scene
  useEffect(() => {
    if (scene) new Image().src = scene
  }, [scene])

  const roundId = round?.id
  const status = round?.status
  const game = round?.game
  useEffect(() => {
    if (!enabled || playing || roundId === undefined || !status || !game) return
    const info = introToPlay({ id: roundId, game, status }, seen)
    if (!info) return

    // Marked seen only when it actually starts, so a view change while the image loads doesn't lose it
    let done = false
    const start = () => {
      if (done) return
      done = true
      markSeen(roundId)
      setLeaving(false)
      setPlaying(info)
    }
    const img = new Image()
    img.onload = start
    img.onerror = start
    img.src = info.scene
    if (img.complete) start()
    const fallback = window.setTimeout(start, IMAGE_WAIT_MS)
    return () => {
      done = true
      window.clearTimeout(fallback)
    }
  }, [enabled, playing, roundId, status, game])

  // Rushes the viewer (or just clears, under reduced motion), then unmounts; a second click while it leaves does nothing
  const dismiss = useCallback(() => {
    if (leaveTimer.current !== null) return
    setLeaving(true)
    leaveTimer.current = window.setTimeout(
      () => {
        leaveTimer.current = null
        setPlaying(null)
      },
      reducedMotion() ? CLEAR_MS : ZOOM_MS,
    )
  }, [])

  // Leaves by itself after the hold. No key dismisses it, so a keystroke never reaches the editor underneath.
  useEffect(() => {
    if (!playing) return
    const hold = window.setTimeout(dismiss, HOLD_MS)
    return () => window.clearTimeout(hold)
  }, [playing, dismiss])

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    },
    [],
  )

  if (!playing) return null
  return (
    <div
      data-testid="round-intro"
      role="status"
      aria-live="polite"
      onClick={dismiss}
      className={`round-intro ${leaving ? 'round-intro--leaving' : ''}`}
    >
      <div className="round-intro__scene" style={{ backgroundImage: `url('${playing.scene}')` }} aria-hidden />
      <div className="round-intro__shade" aria-hidden />
      <div className="round-intro__sweep" aria-hidden />

      <div className="round-intro__text">
        <p className="label !text-khaki tracking-[0.3em]">Directorate of Game Theory · Orders received</p>
        <h2 className="stencil weathered glow text-4xl leading-tight tracking-[0.06em] text-paper uppercase sm:text-6xl">
          <span className="block text-2xl text-khaki sm:text-3xl">Round {playing.number}</span>
          {playing.name}
        </h2>
        <p className="label !text-paper/80 tracking-[0.25em]">{playing.also}</p>
        <div className={`stamp round-intro__stamp text-3xl sm:text-4xl ${STAMP_INK[playing.defcon]}`}>DEFCON {playing.defcon}</div>
      </div>

      <p className="round-intro__hint label !text-[10px] tracking-[0.25em]">Click to continue</p>
    </div>
  )
}
