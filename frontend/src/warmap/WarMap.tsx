import { useEffect, useMemo, useRef, useState } from 'react'
import { FileNumber, RedactionBar, Stamp } from '../components/period'
import { COUNTRIES, LAT_BOTTOM, LAT_TOP, MAP_HEIGHT, MAP_WIDTH, projectX, projectY } from './worldPaths'
import { defconLevel, gameName, roundByGame } from '../lib/rounds'
import { TroopLayer } from './TroopLayer'
import { boardHeading, type BoardState } from './liveState'
import { nationColour } from './palette'
import { territoryCrop, territoryName } from './territoryCrop'
import type { MapNotice, MapRound, MapTerritory, StandingsNation, TeamStatus, TroopMovement } from './types'
import type { FinalResult } from './winner'
import { TerritoryPlate } from './WinnerReveal'
import './WarMap.css'

const STATUS_LABELS: Record<TeamStatus, string> = {
  active: 'Active',
  eliminated: 'Eliminated',
  disqualified: 'Disqualified',
}

/** Placeholder rows on the pre-publish dossier: censored lines where the standings will be typed. */
const REDACTED_ROWS = [14, 11, 16, 9, 13, 10]

/**
 * Where a fallen nation's stamp sits, in % of the map frame: on its territory's anchor. The big
 * (newest) stamp is drawn lifted above its anchor (WarMap.css), so the dead land shows beneath it.
 * A small stamp that would sit under the big one is moved just clear of it, along whichever axis
 * needs the smaller move (so it stays on or beside its own country rather than landing on a
 * neighbour), and the finale reads as separate stamps, not a pile. Sizes match WarMap.css.
 */
const BIG_LIFT = 4.5 // % of frame height the big stamp is raised (translate in .is-new .stamp)
const CLEAR_X = 16 // half the big stamp's width plus half a small one (and a gap), % of frame width
const CLEAR_Y = 8.5 // the same vertically, % of frame height

function stampPlace(code: string, bigCode: string | null | undefined): { left: number; top: number } {
  const [x, y] = COUNTRIES[code].anchor
  let left = (x / MAP_WIDTH) * 100
  let top = (y / MAP_HEIGHT) * 100
  const big = bigCode ? COUNTRIES[bigCode] : undefined
  if (big) {
    const bigLeft = (big.anchor[0] / MAP_WIDTH) * 100
    const bigTop = (big.anchor[1] / MAP_HEIGHT) * 100 - BIG_LIFT
    const dx = left - bigLeft
    const dy = top - bigTop
    if (Math.abs(dx) < CLEAR_X && Math.abs(dy) < CLEAR_Y) {
      if (CLEAR_X - Math.abs(dx) < CLEAR_Y - Math.abs(dy)) left = bigLeft + (dx >= 0 ? CLEAR_X : -CLEAR_X)
      else top = bigTop + (dy >= 0 ? CLEAR_Y : -CLEAR_Y)
    }
  }
  return { left, top }
}

/** How long a score takes to roll to its new value, and how long a territory pulse lives. */
const COUNT_MS = 900
const PULSE_MS = 1600

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface Pulse {
  id: string
  code: string
  /** Rank change or a new claim: a bolder pulse than a score-only change. */
  strong: boolean
}

interface WarEvent {
  id: string
  text: string
  status: TeamStatus
  territory_code: string
}

interface WarMapProps {
  /** null before any round has started. */
  round: MapRound | null
  /** GET /territories, as sent. Claimed ones show in a dim nation colour until ranked. */
  territories: MapTerritory[]
  /** GET /standings `nations`: published results only, [] until the first publish. */
  nations: StandingsNation[]
  /** Server time in ms, for the header clock. */
  serverTime: number
  /** SHOWCASE ONLY. The backend sends no movement data, so the live map never passes this. */
  movements?: TroopMovement[]
  // The leaderboard (every team's score and rank): organisers and the public big board (app/views.ts seesStandings).
  showStandings?: boolean
  /** Scripted showcase loop rather than the server: the header says Demo, not Live. */
  demo?: boolean
  /** A status plate over the map: standby, round in progress, connecting. */
  notice?: MapNotice | null
  /** A poll failed but the last good data is still on screen. */
  signalLost?: boolean
  /** The public leaderboard: the latest published standings, or why there are none (liveState boardState). */
  board: BoardState
  /** The tournament's winner and runner-up (winner.ts finalResult), or null. Shown on the board every visit. */
  final?: FinalResult | null
}

export function WarMap({
  round,
  territories,
  nations,
  serverTime,
  movements,
  showStandings = true,
  demo = false,
  notice = null,
  signalLost = false,
  board,
  final = null,
}: WarMapProps) {
  // Claimed territories with their nation name, from /territories; ranked nations fill any gap.
  const claimedByCode = useMemo(() => {
    const named = new Map<string, string>()
    for (const t of territories) if (t.claimed && t.nation_name) named.set(t.territory_code, t.nation_name)
    for (const n of nations) named.set(n.territory_code, n.nation_name)
    return named
  }, [territories, nations])

  // One fixed colour per territory code, neighbours always apart (palette.ts); never by nation name.
  const colourByCode = useMemo(
    () => new Map([...claimedByCode.keys()].map((code) => [code, nationColour(code)])),
    [claimedByCode],
  )

  const colourByTeam = useMemo(
    () => new Map(nations.map((n) => [n.team_id, colourByCode.get(n.territory_code) ?? '#5A6472'])),
    [nations, colourByCode],
  )

  const nationByCode = useMemo(() => new Map(nations.map((n) => [n.territory_code, n])), [nations])

  const events = useStatusEvents(nations)
  // Fallen nations get a stamp on the map; the newest fall (head of the event log) gets the big one
  const fallen = nations.filter((n) => n.status !== 'active' && COUNTRIES[n.territory_code])
  const newest = events[0] && nations.some((n) => n.territory_code === events[0].territory_code && n.status === events[0].status) ? events[0] : null
  const claimedCodes = useMemo(() => [...claimedByCode.keys()], [claimedByCode])
  const pulses = useTerritoryPulses(nations, claimedCodes)
  const published = nations.length > 0
  const activeCount = nations.filter((n) => n.status === 'active').length
  const claimedCount = territories.filter((t) => t.claimed).length
  const topScore = Math.max(1, ...nations.map((n) => n.score))

  // Each row's slot is its position in the server's list (sorted by rank, api.md §6), not its rank:
  // ranks are only unique within a round, and a nation knocked out earlier keeps its old round's
  // rank, so two rows can share one. The DOM order stays by team_id so moves animate as a slide.
  const heading = board.kind === 'results' && nations.length > 0 ? boardHeading(board) : null
  const slotByTeam = useMemo(() => new Map(nations.map((n, i) => [n.team_id, i])), [nations])
  const rows = useMemo(() => [...nations].sort((a, b) => a.team_id - b.team_id), [nations])
  // The board's #1 (first in the server's list), crowned on the board and on the map while still standing
  const leaderCode = nations[0]?.status === 'active' ? nations[0].territory_code : null

  // Draw nations last so their borders sit above neighbouring land, and the leader above them all.
  const countryCodes = useMemo(() => {
    const layer = (code: string) => (code === leaderCode ? 2 : nationByCode.has(code) ? 1 : 0)
    return Object.keys(COUNTRIES).sort((a, b) => layer(a) - layer(b))
  }, [nationByCode, leaderCode])

  return (
    <div className="warmap">
      {/* The round banner as a dossier strip: DEFCON stamp, the file's title, one dominant tally, the clock */}
      <header className="warmap__header paper-sheet">
        {/* Rounds count up but DEFCON counts down: round 1 is DEFCON 3, round 3 is DEFCON 1 (lib/rounds.ts) */}
        <Stamp tilt={-3} className="warmap__defcon text-type-red">
          <span className="warmap__defcon-label">DEFCON</span> <span className="warmap__defcon-level font-title">{defconLevel(round) || 'ZERO'}</span>
        </Stamp>
        <div data-tour="warmap-round" className="warmap__round">
          <span className="warmap__file" aria-hidden="true">
            <FileNumber number={round ? `DZ-R${round.number}` : 'DZ-R0'} />
          </span>
          <div className="warmap__game font-title">{round ? gameName(round.game) : 'Standby'}</div>
          <div className="warmap__meta font-label">
            {round && <span>Round {round.number}</span>}
            {round && roundByGame(round.game) && <span>{roundByGame(round.game)!.also}</span>}
            {round && <span className={`warmap__pill is-${round.status}`}>{round.status}</span>}
          </div>
        </div>
        {/* The one number that matters on the banner */}
        <div className="warmap__tally font-label">
          {published ? (
            <span>
              <strong className="font-data">{activeCount}</strong> / {nations.length} nations standing
            </span>
          ) : (
            <span>
              <strong className="font-data">{claimedCount}</strong> {claimedCount === 1 ? 'nation' : 'nations'} claimed
            </span>
          )}
        </div>
        <div data-tour="warmap-clock" className="warmap__clock">
          {signalLost ? (
            <span className="warmap__live is-lost font-label" role="status">
              <span className="warmap__live-dot" /> Signal lost · retrying
            </span>
          ) : (
            <span className={`warmap__live font-label ${demo ? 'is-demo' : ''}`}>
              <span className="warmap__live-dot" /> {demo ? 'Demo' : 'Live'}
            </span>
          )}
          <span className="warmap__clock-time font-data">{formatClock(serverTime)} UTC</span>
        </div>
      </header>

      <main className={`warmap__body ${showStandings ? '' : 'is-map-only'}`}>
        <section data-tour="warmap-map" className="warmap__map" aria-label="World map">
          <div className="warmap__frame" style={{ ['--map-ratio' as string]: MAP_WIDTH / MAP_HEIGHT }}>
            <svg
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
            >
              <defs>
                {/* Printed-map hatching: charcoal for eliminated, faded red for disqualified (colours in WarMap.css) */}
                <pattern id="warmap-elim" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="3.2" height="3.2" className="warmap__hatch-ground is-elim" />
                  <line x1="0" y1="0" x2="0" y2="3.2" className="warmap__hatch-line is-elim" />
                </pattern>
                <pattern id="warmap-dq" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                  <rect width="3.2" height="3.2" className="warmap__hatch-ground is-dq" />
                  <line x1="0" y1="0" x2="0" y2="3.2" className="warmap__hatch-line is-dq" />
                </pattern>
              </defs>

              {/* Sea: a faint slate wash, so the paper of the table shows through */}
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="warmap__sea" />

              {countryCodes.map((code) => {
                const shape = COUNTRIES[code]
                const nation = nationByCode.get(code)
                if (!nation) {
                  const claimedBy = claimedByCode.get(code)
                  if (!claimedBy) {
                    return (
                      <path key={code} d={shape.d} className="warmap__country">
                        <title>{shape.name}</title>
                      </path>
                    )
                  }
                  // Claimed but no published result yet: dim nation colour, no glow.
                  return (
                    <path
                      key={code}
                      d={shape.d}
                      className="warmap__country is-claimed-unranked"
                      style={{ ['--nation' as string]: colourByCode.get(code) }}
                    >
                      <title>{`${claimedBy} (${shape.name}) · Claimed, not ranked yet`}</title>
                    </path>
                  )
                }
                return (
                  <path
                    key={code}
                    d={shape.d}
                    className={`warmap__country is-nation is-${nation.status} ${code === leaderCode ? 'is-leader' : ''}`}
                    style={{ ['--nation' as string]: colourByCode.get(code) }}
                  >
                    <title>{`${nation.nation_name} (${shape.name}) · #${nation.rank} · ${STATUS_LABELS[nation.status]}`}</title>
                  </path>
                )
              })}

              {/* A brief outline pulse where a score or rank just changed, or a territory was just claimed */}
              <g className="warmap__pulses" aria-hidden="true">
                {pulses
                  .filter((p) => COUNTRIES[p.code])
                  .map((p) => (
                    <path
                      key={p.id}
                      d={COUNTRIES[p.code].d}
                      className={`warmap__pulse ${p.strong ? 'is-strong' : ''}`}
                      style={{ ['--nation' as string]: colourByCode.get(p.code) }}
                    />
                  ))}
              </g>

              <Graticule />
              <TroopLayer
                movements={movements /* undefined on the live map: bursts only, no arcs */}
                nations={nations}
                serverTime={serverTime}
                colourByTeam={colourByTeam}
                bursts={events}
              />
            </svg>
            {/* Ambient life: faint breathing scanlines and a slow recon sweep over the map (WarMap.css) */}
            <div className="warmap__ambient" aria-hidden="true">
              <span className="warmap__scan" />
              <span className="warmap__sweep" />
            </div>
            {/* Fallen nations, stamped over their territory (HTML over the map, placed by % at each anchor).
                The newest fall lands big with an impact ring; earlier ones keep a small faded stamp. */}
            {fallen.length > 0 && (
              <div className="warmap__mapstamps" aria-hidden="true">
                {fallen.map((n) => {
                  const isNew = newest?.territory_code === n.territory_code
                  const { left, top } = stampPlace(n.territory_code, isNew ? null : newest?.territory_code)
                  return (
                    <span
                      // Keyed by the event for the newest, so a fresh fall always replays its landing
                      key={isNew ? newest!.id : `${n.team_id}-${n.status}`}
                      className={`warmap__mapstamp is-${n.status} ${isNew ? 'is-new' : ''}`}
                      style={{ left: `${left}%`, top: `${top}%` }}
                    >
                      {isNew && <span className="warmap__fall-impact" />}
                      <Stamp
                        land={isNew}
                        tilt={-12}
                        className={isNew || n.status === 'disqualified' ? 'text-type-red' : 'text-type-ink'}
                      >
                        {STATUS_LABELS[n.status]}
                      </Stamp>
                    </span>
                  )
                })}
              </div>
            )}
            <span className="warmap__corner is-tl" />
            <span className="warmap__corner is-tr" />
            <span className="warmap__corner is-bl" />
            <span className="warmap__corner is-br" />
            {notice && (
              <div className={`warmap__notice paper-sheet is-${notice.tone}`} role="status">
                <span className="warmap__notice-title font-label">{notice.title}</span>
                <span className="warmap__notice-detail">{notice.detail}</span>
              </div>
            )}
          </div>

          <ol className="warmap__events" aria-live="polite">
            {events.map((e) => (
              <li key={e.id} className={`warmap__event paper-sheet font-label is-${e.status}`}>{e.text}</li>
            ))}
          </ol>
        </section>

        {showStandings && (
          <aside data-tour="warmap-board" className="warmap__board paper-sheet" aria-label={heading ? `Leaderboard: ${heading.title}` : 'Leaderboard'}>
            <header className="warmap__board-head">
              <h2 className="warmap__board-title font-title">Standings</h2>
              {heading && (
                <>
                  <p className="warmap__board-round font-label">{heading.title}</p>
                  {heading.sub && (
                    <p className="warmap__board-pending" role="status">
                      <span className="warmap__await-dot" /> {heading.sub}
                    </p>
                  )}
                </>
              )}
            </header>
            {/* The final result, above the final standings: every visit, never gated like the reveal */}
            {final && <WinnerBanner final={final} territories={territories} />}
            {board.kind === 'awaiting' || rows.length === 0 ? (
              // Nothing published yet: a dossier with its standings censored, so the empty board reads as intentional
              <div className="warmap__await" role="status">
                <Stamp tilt={-4} className="warmap__await-title text-type-brass">
                  {board.kind === 'awaiting' ? board.title : 'Awaiting results'}
                </Stamp>
                {board.kind === 'awaiting' && <span className="warmap__await-detail font-label">{board.detail}</span>}
                <div className="warmap__await-sheet" aria-hidden="true">
                  {REDACTED_ROWS.map((w, i) => (
                    <span key={i} className="warmap__await-line">
                      <span className="warmap__await-rank font-data">{String(i + 1).padStart(2, '0')}</span>
                      <RedactionBar width={w} />
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="warmap__cols font-label" aria-hidden="true">
                  <span>Rank</span>
                  <span>Nation</span>
                  <span>Score</span>
                </div>
                {/* Rows scroll if there are ever too many to fit; the footer below always stays in view */}
                <div className="warmap__rows-scroll">
                  <ol className="warmap__rows" style={{ ['--rows' as string]: rows.length }}>
                    {rows.map((n) => (
                      <LeaderRow
                        key={n.team_id}
                        nation={n}
                        slot={slotByTeam.get(n.team_id) ?? 0}
                        colour={colourByCode.get(n.territory_code) ?? '#5A6472'}
                        share={Math.max(0, n.score) / topScore}
                      />
                    ))}
                  </ol>
                </div>
                <p className="warmap__board-foot font-label">
                  <strong className="font-data">{activeCount}</strong> standing · {nations.length} ranked
                </p>
              </>
            )}
          </aside>
        )}
      </main>
    </div>
  )
}

/** Cold start with nothing to show: the server could not be reached. Polling keeps retrying underneath. */
export function WarMapFault({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="warmap">
      <div className="warmap__fault paper-sheet" role="alert">
        <span className="warmap__fault-label font-label">
          <span className="warmap__live-dot" /> Signal lost
        </span>
        <h2 className="warmap__fault-title font-title">Cannot reach command</h2>
        <p className="warmap__fault-detail font-label">The war map could not load from the server. It keeps trying on its own.</p>
        <button type="button" className="warmap__retry font-data" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Retry now'}
        </button>
      </div>
    </div>
  )
}

/**
 * The winner, typed onto the board above the final standings with a victor's stamp, and the
 * runner-up beneath it, smaller. The once-only full-screen moment is WinnerReveal.
 */
function WinnerBanner({ final, territories }: { final: FinalResult; territories: MapTerritory[] }) {
  const { winner, runnerUp } = final
  const crop = territoryCrop(winner.territory_code)
  return (
    <section
      data-testid="winner-banner"
      className="warmap__winner"
      aria-label="Tournament result"
      style={{ ['--nation' as string]: nationColour(winner.territory_code) }}
    >
      <div data-testid="winner-banner-winner" className="warmap__winner-main">
        {crop ? (
          <TerritoryPlate code={winner.territory_code} viewBox={crop.viewBox} className="warmap__winner-map" />
        ) : (
          <span className="warmap__winner-map is-blank font-data" aria-hidden="true">{winner.territory_code}</span>
        )}
        <span className="warmap__winner-text">
          <span className="warmap__winner-label font-label">Winner</span>
          <span className="warmap__winner-name font-title">{winner.nation_name}</span>
          <span className="warmap__winner-where font-label">
            {territoryName(winner.territory_code, territories)} <span className="font-data">· {winner.territory_code}</span>
          </span>
        </span>
        <Stamp tilt={-10} className="warmap__winner-stamp text-type-red">Victor</Stamp>
      </div>
      {runnerUp && (
        <p
          data-testid="winner-banner-runner-up"
          className="warmap__winner-runner font-label"
          style={{ ['--nation' as string]: nationColour(runnerUp.territory_code) }}
        >
          <span className="warmap__winner-runner-label">Runner-up</span>
          <span className="warmap__swatch" aria-hidden="true" />
          <span className="warmap__winner-runner-name">{runnerUp.nation_name}</span>
          <span className="warmap__code font-data">{runnerUp.territory_code}</span>
        </p>
      )}
    </section>
  )
}

function LeaderRow({ nation, slot, colour, share }: { nation: StandingsNation; slot: number; colour: string; share: number }) {
  // The score rolls to a new value; whole numbers while rolling, the exact score once it lands
  const shown = useCountUp(nation.score)
  return (
    <li
      className={`warmap__row is-${nation.status} ${slot === 0 ? 'is-leader' : ''}`}
      // Slot steps by --row-h (WarMap.css), so the list fits the board at any screen height
      style={{ transform: `translateY(calc(${slot} * var(--row-h)))`, ['--nation' as string]: colour }}
      aria-label={`Rank ${nation.rank}: ${nation.nation_name} (${nation.territory_code}), ${formatScore(nation.score)} points, ${STATUS_LABELS[nation.status]}`}
    >
      {/* The server's rank, shown as sent; never recomputed from the score. */}
      <span className="warmap__rank font-data">{String(nation.rank).padStart(2, '0')}</span>
      <span className="warmap__swatch" />
      <span className="warmap__name font-label">
        {nation.nation_name}
        <span className="warmap__code font-data">{nation.territory_code}</span>
      </span>
      <span className="warmap__score font-data">
        {formatScore(shown === nation.score ? nation.score : Math.round(shown))}
        {nation.status !== 'active' && <span className="warmap__tag font-label">{STATUS_LABELS[nation.status]}</span>}
      </span>
      <span className="warmap__bar" style={{ transform: `scaleX(${share})` }} />
    </li>
  )
}

// Faint lat/long grid every 15°, with the equator and tropics picked out.
function Graticule() {
  const lines = []
  for (let lon = -165; lon <= 165; lon += 15) {
    const x = projectX(lon)
    lines.push(<line key={`lon${lon}`} x1={x} y1={0} x2={x} y2={MAP_HEIGHT} className={lon === 0 ? 'is-major' : ''} />)
  }
  for (let lat = -45; lat <= 75; lat += 15) {
    const y = projectY(lat)
    lines.push(<line key={`lat${lat}`} x1={0} y1={y} x2={MAP_WIDTH} y2={y} className={lat === 0 ? 'is-major' : ''} />)
  }
  for (const lat of [23.44, -23.44]) {
    const y = projectY(lat)
    lines.push(<line key={`trop${lat}`} x1={0} y1={y} x2={MAP_WIDTH} y2={y} className="is-tropic" />)
  }

  const labels = []
  for (let lat = -45; lat <= 75; lat += 15) {
    if (lat <= LAT_BOTTOM || lat >= LAT_TOP) continue
    labels.push(
      <text key={`l${lat}`} x={4} y={projectY(lat) - 2}>
        {lat === 0 ? '0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`}
      </text>,
    )
  }
  for (let lon = -150; lon <= 150; lon += 30) {
    labels.push(
      <text key={`m${lon}`} x={projectX(lon) + 2} y={MAP_HEIGHT - 4}>
        {lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`}
      </text>,
    )
  }

  return (
    <g className="warmap__grid" aria-hidden="true">
      {lines}
      <g className="warmap__grid-labels">{labels}</g>
    </g>
  )
}

// Diff successive standings and keep a short log of status changes.
function useStatusEvents(nations: StandingsNation[]): WarEvent[] {
  const prev = useRef<Map<number, TeamStatus> | null>(null)
  const seq = useRef(0)
  const [events, setEvents] = useState<WarEvent[]>([])

  useEffect(() => {
    const before = prev.current
    const now = new Map(nations.map((n) => [n.team_id, n.status]))
    prev.current = now
    if (!before) return

    // A full reset (scripted loop restarting) clears the log.
    if ([...now.values()].every((s) => s === 'active') && [...before.values()].some((s) => s !== 'active')) {
      setEvents([])
      return
    }

    const batch = ++seq.current
    const fresh: WarEvent[] = nations
      .filter((n) => n.status !== 'active' && before.get(n.team_id) !== n.status)
      .map((n) => ({
        id: `${batch}-${n.team_id}`,
        status: n.status,
        territory_code: n.territory_code,
        text: n.status === 'eliminated'
          ? `${n.nation_name} has been eliminated`
          : `${n.nation_name} has been disqualified`,
      }))
    if (fresh.length) setEvents((list) => [...fresh, ...list].slice(0, 4))
  }, [nations])

  return events
}

/**
 * A number that rolls from its last value to a new one (ease-out), instead of snapping. Display only:
 * the target is always the server's value. Reduced motion: the new value at once. A roll that is cut
 * short by a newer value continues from wherever it had got to.
 */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target)
  const current = useRef(target)

  useEffect(() => {
    const from = current.current
    if (from === target) return
    if (reducedMotion()) {
      current.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / COUNT_MS)
      const value = p < 1 ? from + (target - from) * (1 - (1 - p) ** 3) : target
      current.current = value
      setShown(value)
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return shown
}

/**
 * Territories to pulse, from successive data the map already has: a nation whose rank changed
 * (strong) or only its score (light), and a territory newly claimed (strong). Nothing on first load,
 * and no claim pulses while the claimed list is first arriving. Reduced motion: none.
 */
function useTerritoryPulses(nations: StandingsNation[], claimedCodes: string[]): Pulse[] {
  const prev = useRef<{ standing: Map<string, [number, number]>; claimed: Set<string> } | null>(null)
  const seq = useRef(0)
  const [pulses, setPulses] = useState<Pulse[]>([])

  useEffect(() => {
    const standing = new Map(nations.map((n) => [n.territory_code, [n.score, n.rank] as [number, number]]))
    const claimed = new Set(claimedCodes)
    const before = prev.current
    prev.current = { standing, claimed }
    if (!before || reducedMotion()) return

    const batch = ++seq.current
    const fresh: Pulse[] = []
    for (const [code, [score, rank]] of standing) {
      const old = before.standing.get(code)
      if (!old) continue
      if (old[1] !== rank) fresh.push({ id: `${batch}-${code}`, code, strong: true })
      else if (old[0] !== score) fresh.push({ id: `${batch}-${code}`, code, strong: false })
    }
    if (before.claimed.size > 0) {
      for (const code of claimed) if (!before.claimed.has(code)) fresh.push({ id: `${batch}-${code}`, code, strong: true })
    }
    if (fresh.length === 0) return

    setPulses(fresh)
    const done = window.setTimeout(() => setPulses((list) => list.filter((p) => !fresh.includes(p))), PULSE_MS)
    return () => window.clearTimeout(done)
  }, [nations, claimedCodes])

  return pulses
}

// Scores are floats (Theatre of War gives half points, api.md §8). Fixed locale so the projector
// reads the same whatever machine drives it; up to two decimals, so nothing the server sent is hidden.
const SCORE_FORMAT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
function formatScore(score: number) {
  return SCORE_FORMAT.format(score)
}

function formatClock(ms: number) {
  return new Date(ms).toISOString().slice(11, 19)
}
