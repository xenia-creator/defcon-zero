import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TornEdge } from '../components/period'
import type { Round } from '../lib/contract'
import { keys, useStandings } from '../lib/queries'
import { nationColour } from './palette'
import { territoryCrop, territoryName } from './territoryCrop'
import { TerritoryPlate } from './TerritoryPlate'
import type { StandingsNation } from './types'
import { formatScore } from './WarMap'
import { finalResult } from './winner'
import { flashStep, isFinalPublished, markShownInTab, rearmTab, shownInTab } from './flashStep'
import './WinnerFlash.css'

/**
 * The exit, as RoundIntro: the room rushes the viewer for ZOOM_MS (round-intro-rush), or under
 * reduced motion simply clears in CLEAR_MS. There is no hold timer: the flash stays until clicked.
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

/** Browser automation sets navigator.webdriver; the flash never covers the screen under an e2e test. */
const AUTOMATED = typeof navigator !== 'undefined' && navigator.webdriver === true

/** Country names come from the map's own data (worldPaths), so no /territories read is needed. */
const NO_TERRITORIES: never[] = []

/**
 * The tournament's one full-screen winner announcement, mounted once at app level (App.tsx), so it
 * plays on whatever screen the viewer is on: the Command Console, a team's workspace, the war map.
 *
 * Fires the moment Round 3 is published (flashStep.ts): the round comes from the app's
 * GET /rounds/current poll (the organiser's own publish refreshes it at once), and the standings are
 * read, and refetched, only from then on. Once per browser tab; latecomers get it too.
 *
 * Everything shown is live data from GET /standings through finalResult (winner.ts): rank 1 on top,
 * rank 2 below, each with its nation name, territory map, colour (palette.ts), country and code, and
 * final score. Nothing about any nation is written into this file.
 *
 * Teams: views.ts keeps the leaderboard from teams. This is a deliberate, documented exception:
 * after the final is published, teams see the top two only, through this flash, read from the
 * public GET /standings. No other standings reach them.
 */
export function WinnerFlash({ round }: { round: Round | null | undefined }) {
  // AUTOMATED never changes during a page's life, so this never switches hooks on or off
  return AUTOMATED ? null : <Flash round={round} />
}

function Flash({ round }: { round: Round | null | undefined }) {
  const finalPublished = isFinalPublished(round)
  const standingsQ = useStandings(finalPublished)
  const queries = useQueryClient()

  // The moment the final reads published, fetch the standings again at once rather than waiting for
  // a poll. Invalidating cancels a poll still in flight from before the publish, whose answer would
  // be the previous round's.
  const roundId = round?.id
  useEffect(() => {
    if (finalPublished) void queries.invalidateQueries({ queryKey: keys.standings })
  }, [finalPublished, roundId, queries])

  const final = finalPublished ? finalResult(round, standingsQ.data) : null

  const [playingId, setPlayingId] = useState<number | null>(null)
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<number | null>(null)

  const step = flashStep(round, final, shownInTab)
  const stepKind = step.kind
  const stepRound = step.kind === 'play' ? step.roundId : null
  useEffect(() => {
    if (stepKind === 'rearm') {
      rearmTab()
      setPlayingId(null)
      return
    }
    if (stepKind !== 'play' || stepRound === null || playingId !== null) return
    markShownInTab(stepRound)
    setLeaving(false)
    setPlayingId(stepRound)
  }, [stepKind, stepRound, playingId])

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

  // The names come from the live result, so a change in the standings shows at once, and if the
  // result is withdrawn (finalResult null) the flash goes with it
  if (playingId === null || !final || final.roundId !== playingId) return null
  const { winner, runnerUp } = final

  return (
    <div
      data-testid="winner-flash"
      role="status"
      aria-live="polite"
      onClick={dismiss}
      className={`winner-flash ${leaving ? 'winner-flash--leaving' : ''}`}
      style={{ ['--nation' as string]: nationColour(winner.territory_code) }}
    >
      <WarRoom />

      <div className="winner-flash__stage">
        <p className="winner-flash__kicker font-data">Directorate of Game Theory · Final dispatch</p>
        <p className="winner-flash__victory font-title">Victory</p>
        <div className="winner-flash__title">
          <Laurel className="winner-flash__laurel" />
          <h2 data-testid="winner-flash-winner-name" className="winner-flash__name font-title">
            {winner.nation_name}
          </h2>
          <Laurel className="winner-flash__laurel winner-flash__laurel--right" />
        </div>

        <WinnerCard nation={winner} />
        {runnerUp && <RunnerUpCard nation={runnerUp} />}
      </div>

      <p className="winner-flash__hint label !text-[10px] tracking-[0.25em]">Click to continue</p>
    </div>
  )
}

/** "ARGENTINA · AR", from the map's data for the code (falls back to the code alone). */
function countryLabel(code: string) {
  return `${territoryName(code, NO_TERRITORIES).toUpperCase()} · ${code}`
}

/** The nation's territory in its colour, or its code when the map has no shape for it. */
function NationMap({ code, className }: { code: string; className: string }) {
  const crop = territoryCrop(code)
  return crop ? (
    <TerritoryPlate code={code} viewBox={crop.viewBox} className={className} />
  ) : (
    <span className={`${className} is-blank font-data`} aria-hidden>
      {code}
    </span>
  )
}

function WinnerCard({ nation }: { nation: StandingsNation }) {
  const label = countryLabel(nation.territory_code)
  const score = formatScore(nation.score)
  return (
    <section
      data-testid="winner-flash-winner"
      className="winner-flash__card winner-flash__card--winner paper-sheet"
      style={{ ['--nation' as string]: nationColour(nation.territory_code) }}
      aria-label={`Winner: ${nation.nation_name}, ${label}, ${score} points`}
    >
      <TornEdge />
      <TornEdge className="winner-flash__tear-bottom" />
      <NationMap code={nation.territory_code} className="winner-flash__map" />
      <p className="winner-flash__caption">
        <span data-testid="winner-flash-winner-country" className="font-label">{label}</span>
        <span data-testid="winner-flash-winner-score" className="winner-flash__score font-data">{score}</span>
      </p>
      <span className="winner-flash__seal-spot">
        <WaxSeal metal="gold" top="VICTOR" bottom="· 1ST ·" />
      </span>
    </section>
  )
}

function RunnerUpCard({ nation }: { nation: StandingsNation }) {
  const label = countryLabel(nation.territory_code)
  const score = formatScore(nation.score)
  return (
    <section
      data-testid="winner-flash-runner-up"
      className="winner-flash__card winner-flash__card--runner paper-sheet"
      style={{ ['--nation' as string]: nationColour(nation.territory_code) }}
      aria-label={`Runner-up: ${nation.nation_name}, ${label}, ${score} points`}
    >
      <TornEdge />
      <span className="winner-flash__seal-spot">
        <WaxSeal metal="silver" top="SILVER" bottom="2ND" />
      </span>
      <NationMap code={nation.territory_code} className="winner-flash__runner-map" />
      <span className="winner-flash__runner-text">
        <span className="winner-flash__runner-tag font-data">Runner-up</span>
        <span data-testid="winner-flash-runner-up-name" className="winner-flash__runner-name font-title">
          {nation.nation_name}
        </span>
        <span data-testid="winner-flash-runner-up-country" className="winner-flash__runner-where font-label">{label}</span>
        <span data-testid="winner-flash-runner-up-score" className="winner-flash__score font-data">{score}</span>
      </span>
    </section>
  )
}

/*
 * The room behind: two spotlights from above, a floor grid running away in perspective, a warm glow
 * at the centre and embers drifting up the sides. Decorative only; gradients, transforms and opacity.
 */
const rand = (i: number, n: number) => {
  const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453
  return x - Math.floor(x)
}
/** Most embers rise up the sides, a few faint ones through the middle, so the centre stays crisp. */
const EMBERS = Array.from({ length: 44 }, (_, i) => {
  const middle = i % 5 === 0
  const left = i % 2 === 0
  const x = middle ? 30 + rand(i, 1) * 40 : left ? rand(i, 1) * 28 : 72 + rand(i, 1) * 28
  return {
    x: `${x.toFixed(2)}%`,
    size: `${(2 + rand(i, 2) * 3.5).toFixed(1)}px`,
    duration: `${(7 + rand(i, 3) * 7).toFixed(2)}s`,
    delay: `${(-rand(i, 4) * 14).toFixed(2)}s`,
    drift: `${((rand(i, 5) - 0.5) * 120).toFixed(0)}px`,
    alpha: (middle ? 0.35 : 0.6 + rand(i, 6) * 0.4).toFixed(2),
  }
})

function WarRoom() {
  return (
    <div className="winner-flash__room" aria-hidden>
      <span className="winner-flash__wall" />
      <span className="winner-flash__side winner-flash__side--left" />
      <span className="winner-flash__side winner-flash__side--right" />
      <span className="winner-flash__floor" />
      <span className="winner-flash__beam winner-flash__beam--left" />
      <span className="winner-flash__beam winner-flash__beam--right" />
      <span className="winner-flash__glow" />
      <span className="winner-flash__embers">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="winner-flash__ember"
            style={{
              ['--x' as string]: e.x,
              ['--size' as string]: e.size,
              ['--duration' as string]: e.duration,
              ['--delay' as string]: e.delay,
              ['--drift' as string]: e.drift,
              ['--alpha' as string]: e.alpha,
            }}
          />
        ))}
      </span>
      <span className="winner-flash__vignette" />
    </div>
  )
}

/*
 * A laurel branch: leaves set along a curved stem. Drawn once for the left side; the right one is
 * the same branch mirrored by a transform (WinnerFlash.css).
 */
const STEM = { p0: [46, 118], p1: [-4, 72], p2: [34, 6] } as const
const LEAF = 'M0,0 C4.2,-5 4.6,-12 0,-19 C-4.6,-12 -4.2,-5 0,0 Z'
const LEAVES = (() => {
  const at = (t: number) => {
    const u = 1 - t
    const { p0, p1, p2 } = STEM
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
    const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
    return { x, y, deg: (Math.atan2(dy, dx) * 180) / Math.PI + 90 }
  }
  const leaves: { x: number; y: number; deg: number; scale: number }[] = []
  for (let i = 0; i < 8; i++) {
    const t = 0.1 + i * 0.11
    const { x, y, deg } = at(t)
    const scale = 1.05 - i * 0.05
    leaves.push({ x, y, deg: deg - 42, scale }, { x, y, deg: deg + 42, scale })
  }
  const tip = at(1)
  leaves.push({ ...tip, scale: 0.75 })
  return leaves
})()

function Laurel({ className }: { className: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 64 124" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1d58c" />
          <stop offset="0.55" stopColor="#c19a45" />
          <stop offset="1" stopColor="#7a5a1e" />
        </linearGradient>
      </defs>
      <path
        d={`M${STEM.p0.join(',')} Q${STEM.p1.join(',')} ${STEM.p2.join(',')}`}
        fill="none"
        stroke="#a9853a"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {LEAVES.map((l, i) => (
        <path
          key={i}
          d={LEAF}
          fill={`url(#${id}-leaf)`}
          stroke="#5c4314"
          strokeWidth="0.6"
          transform={`translate(${l.x.toFixed(2)} ${l.y.toFixed(2)}) rotate(${l.deg.toFixed(1)}) scale(${l.scale.toFixed(2)})`}
        />
      ))}
    </svg>
  )
}

/*
 * A worn wax seal: an uneven blob of wax with a pressed ring and two lines of raised lettering.
 * Gold for the winner, silver for the runner-up. Wear is drawn in (scuffs, a lighter rim), not
 * filtered.
 */
const SEAL_PATH = (() => {
  const points = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2
    const r = 54 + 2.6 * Math.sin(a * 5 + 0.4) + 1.6 * Math.sin(a * 11 + 1.3) + 1.1 * Math.sin(a * 17)
    return [60 + r * Math.cos(a), 60 + r * Math.sin(a)]
  })
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const start = mid(points[35], points[0])
  let d = `M${start[0].toFixed(2)},${start[1].toFixed(2)}`
  points.forEach((p, i) => {
    const m = mid(p, points[(i + 1) % 36])
    d += ` Q${p[0].toFixed(2)},${p[1].toFixed(2)} ${m[0].toFixed(2)},${m[1].toFixed(2)}`
  })
  return `${d} Z`
})()

const METALS = {
  gold: { hi: '#fbe7a6', mid: '#d4a640', lo: '#7c5512', ink: '#5a3c08', rim: '#f6dc8f' },
  silver: { hi: '#f7f7f3', mid: '#b4b5b0', lo: '#5e605c', ink: '#3b3c39', rim: '#ecece6' },
} as const

const SCUFFS = [
  [36, 30, 7, 2.2, -30],
  [86, 44, 5, 1.6, 20],
  [30, 78, 6, 1.8, 40],
  [82, 88, 8, 2, -15],
  [62, 22, 4, 1.4, 5],
] as const

function WaxSeal({ metal, top, bottom }: { metal: keyof typeof METALS; top: string; bottom: string }) {
  const id = useId()
  const m = METALS[metal]
  return (
    <svg viewBox="0 0 120 120" className={`winner-flash__seal winner-flash__seal--${metal}`} aria-hidden>
      <defs>
        <radialGradient id={`${id}-wax`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={m.hi} />
          <stop offset="0.45" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </radialGradient>
        <radialGradient id={`${id}-well`} cx="0.6" cy="0.68" r="0.7">
          <stop offset="0" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </radialGradient>
      </defs>
      <path d={SEAL_PATH} fill={`url(#${id}-wax)`} />
      <path d={SEAL_PATH} fill="none" stroke={m.rim} strokeOpacity="0.45" strokeWidth="1.4" transform="translate(-1 -1)" />
      {/* The pressed well inside the rim */}
      <circle cx="60" cy="60" r="41" fill={`url(#${id}-well)`} opacity="0.55" />
      <circle cx="60" cy="60" r="41" fill="none" stroke={m.ink} strokeOpacity="0.55" strokeWidth="2.4" />
      <circle cx="60" cy="60" r="43.5" fill="none" stroke={m.rim} strokeOpacity="0.5" strokeWidth="1" />
      {SCUFFS.map(([x, y, rx, ry, deg], i) => (
        <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${deg} ${x} ${y})`} fill={i % 2 ? m.lo : m.hi} opacity="0.35" />
      ))}
      {/* Raised lettering: a light edge under the dark ink */}
      {[
        { y: 58, size: 19, text: top },
        { y: 80, size: 15, text: bottom },
      ].map((line) => (
        <g key={line.y} className="winner-flash__seal-text" fontSize={line.size} textAnchor="middle">
          <text x="60.8" y={line.y + 0.9} fill={m.rim} opacity="0.7">
            {line.text}
          </text>
          <text x="60" y={line.y} fill={m.ink}>
            {line.text}
          </text>
        </g>
      ))}
    </svg>
  )
}
