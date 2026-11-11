import { useCallback, useEffect, useRef, useState } from 'react'
import { Stamp } from '../components/period'
import { nationColour } from './palette'
import { territoryCrop, territoryName } from './territoryCrop'
import type { MapTerritory, StandingsNation } from './types'
import type { FinalResult } from './winner'
import { COUNTRIES } from './worldPaths'

/**
 * The exit, as RoundIntro: the card rushes the viewer for ZOOM_MS (round-intro-rush), or under
 * reduced motion simply clears in CLEAR_MS. There is no hold timer: the reveal stays until clicked.
 */
const ZOOM_MS = 650
const CLEAR_MS = 200

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Its own key, apart from RoundIntro's dz.intro.<id>, so one never stops the other playing
const seenKey = (roundId: number) => `dz.winner.${roundId}`
// Used when localStorage is blocked (private window), so the reveal still plays only once per page load
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

/** Browser automation sets navigator.webdriver; the reveal never covers the screen under an e2e test. */
const AUTOMATED = typeof navigator !== 'undefined' && navigator.webdriver === true

/**
 * The winner reveal: once the final round is published (winner.ts, finalResult), the winning
 * nation fills the screen: VICTORY, its name in stencil, its territory with a victor's seal, and
 * the runner-up below. Plays once per browser, on the live war map only, and stays until clicked
 * (never a key). Styled after RoundIntro (WarMap.css, "Winner reveal").
 */
interface RevealProps {
  result: FinalResult | null
  territories: readonly MapTerritory[]
  /** Told when the reveal comes on screen and when it has gone, so the war map can hold its tour meanwhile. */
  onShowingChange?: (showing: boolean) => void
}

export function WinnerReveal(props: RevealProps) {
  // AUTOMATED never changes during a page's life, so this never switches hooks on or off
  return AUTOMATED ? null : <Reveal {...props} />
}

function Reveal({ result, territories, onShowingChange }: RevealProps) {
  // Which final is on screen. The names come from the live result, so a change in the standings
  // shows at once, and if the result is withdrawn (finalResult null) the reveal goes with it.
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<number | null>(null)

  const roundId = result?.roundId
  useEffect(() => {
    if (playingId !== null || roundId === undefined || seen(roundId)) return
    markSeen(roundId)
    setLeaving(false)
    setPlayingId(roundId)
  }, [playingId, roundId])

  // Rushes the viewer (or just clears, under reduced motion), then unmounts; a second click while it leaves does nothing
  const dismiss = useCallback(() => {
    if (leaveTimer.current !== null) return
    setLeaving(true)
    leaveTimer.current = window.setTimeout(
      () => {
        leaveTimer.current = null
        setPlayingId(null)
      },
      reducedMotion() ? CLEAR_MS : ZOOM_MS,
    )
  }, [])

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    },
    [],
  )

  const showing = playingId !== null && !!result && result.roundId === playingId
  useEffect(() => {
    onShowingChange?.(showing)
  }, [showing, onShowingChange])

  if (!showing) return null
  const { winner, runnerUp } = result
  const crop = territoryCrop(winner.territory_code)
  return (
    <div
      data-testid="winner-reveal"
      role="status"
      aria-live="polite"
      onClick={dismiss}
      className={`winner-reveal ${leaving ? 'winner-reveal--leaving' : ''}`}
      style={{ ['--nation' as string]: nationColour(winner.territory_code) }}
    >
      <div className="winner-reveal__bloom" aria-hidden />
      <div className="winner-reveal__shade" aria-hidden />
      <div className="winner-reveal__sweep" aria-hidden />

      <div className="winner-reveal__text">
        <p className="label !text-khaki tracking-[0.3em]">Directorate of Game Theory · Final dispatch</p>
        <p className="winner-reveal__victory font-title">Victory</p>
        <h2 data-testid="winner-reveal-winner" className="winner-reveal__name font-title glow">
          {winner.nation_name}
        </h2>

        <div className="winner-reveal__plate paper-sheet">
          {crop ? (
            <TerritoryPlate code={winner.territory_code} viewBox={crop.viewBox} className="winner-reveal__territory" />
          ) : (
            <span className="winner-reveal__territory is-blank font-data" aria-hidden>
              {winner.territory_code}
            </span>
          )}
          <p className="winner-reveal__caption font-label">
            {territoryName(winner.territory_code, territories)} <span className="font-data">· {winner.territory_code}</span>
          </p>
          <span className="winner-reveal__seal-spot">
            <Stamp land className="winner-seal text-type-red">
              <span className="winner-seal__star" aria-hidden>★</span>
              <span className="winner-seal__word">Victor</span>
              <span className="winner-seal__small">DEFCON Zero</span>
            </Stamp>
          </span>
        </div>

        {runnerUp && <RunnerUp nation={runnerUp} territories={territories} />}
      </div>

      <p className="winner-reveal__hint label !text-[10px] tracking-[0.25em]">Click to continue</p>
    </div>
  )
}

function RunnerUp({ nation, territories }: { nation: StandingsNation; territories: readonly MapTerritory[] }) {
  const crop = territoryCrop(nation.territory_code)
  return (
    <div
      data-testid="winner-reveal-runner-up"
      className="winner-reveal__runner field-kit"
      style={{ ['--nation' as string]: nationColour(nation.territory_code) }}
    >
      {crop ? (
        <TerritoryPlate code={nation.territory_code} viewBox={crop.viewBox} className="winner-reveal__runner-map" />
      ) : (
        <span className="winner-reveal__runner-swatch" aria-hidden />
      )}
      <span className="winner-reveal__runner-label font-label">Runner-up</span>
      <span className="winner-reveal__runner-name font-title">{nation.nation_name}</span>
      <span className="winner-reveal__runner-where font-label">
        {territoryName(nation.territory_code, territories)} <span className="font-data">· {nation.territory_code}</span>
      </span>
    </div>
  )
}

/**
 * One territory in its nation colour (--nation on an ancestor), its neighbours faint around it for
 * context. Strokes stay a fixed width however far the crop zooms in.
 */
export function TerritoryPlate({ code, viewBox, className = '' }: { code: string; viewBox: string; className?: string }) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className={`territory-plate ${className}`} aria-hidden>
      {Object.entries(COUNTRIES).map(([c, shape]) =>
        c === code ? null : <path key={c} d={shape.d} className="territory-plate__land" vectorEffect="non-scaling-stroke" />,
      )}
      <path d={COUNTRIES[code].d} className="territory-plate__nation" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
