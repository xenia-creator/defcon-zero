import { useEffect, useMemo, useRef, useState } from 'react'
import { COUNTRIES, LAT_BOTTOM, LAT_TOP, MAP_HEIGHT, MAP_WIDTH, projectX, projectY } from './worldPaths'
import { AmbientBackground } from './AmbientBackground'
import { TroopLayer } from './TroopLayer'
import type { Round, StandingsNation, StandingsResponse, TeamStatus, TerritoriesResponse, TroopMovement } from './types'
import './WarMap.css'

// Pinned colours per nation name. Chosen so bordering territories get far-apart
// hues: RU red / CN jade / KZ violet / JP gold, US blue / CA orange, IN rose vs CN jade.
const NATION_COLOUR_BY_NAME: Record<string, string> = {
  'Red Dawn': '#E5253C', // red
  'Jade Dynasty': '#00C27A', // jade
  'Liberty Bloc': '#3D7BFF', // blue
  'Amazon Pact': '#FF2BD6', // magenta
  'Sahara Front': '#F5A526', // amber
  'Maple Accord': '#FF6A1A', // orange
  'Iron Steppe': '#A855F7', // violet
  'Rising Sun': '#FFE53B', // gold
  'Monsoon Union': '#FF5C93', // rose
  'Southern Cross': '#00E5FF', // cyan
}

// Fallback for unmapped nations, assigned in team_id order after skipping any
// colour already pinned to a nation on the board.
const FALLBACK_COLOURS = [
  '#00E5FF', // cyan
  '#20C95E', // green
  '#FF2BD6', // magenta
  '#F5A526', // amber
  '#3D7BFF', // electric blue
  '#FF6A1A', // orange
  '#A855F7', // violet
  '#D4FF2B', // lime
  '#FFE53B', // gold
  '#E5253C', // red
]

const GAME_LABELS: Record<Round['game'], string> = {
  prisoners_dilemma: "Prisoner's Dilemma",
  theatre_of_war: 'Theatre of War',
  foreign_aid: 'Foreign Aid',
}

const STATUS_LABELS: Record<TeamStatus, string> = {
  active: 'Active',
  eliminated: 'Eliminated',
  disqualified: 'Disqualified',
}

const ROW_HEIGHT = 56

interface WarEvent {
  id: string
  text: string
  status: TeamStatus
  territory_code: string
}

interface WarMapProps {
  round: Round
  territories: TerritoriesResponse
  standings: StandingsResponse
  // Provisional troop data; see TroopMovement in types.ts.
  movements?: TroopMovement[]
}

const NO_MOVES: TroopMovement[] = []

export function WarMap({ round, territories, standings, movements = NO_MOVES }: WarMapProps) {
  const colourByTeam = useMemo(() => {
    const nations = [...standings.nations].sort((a, b) => a.team_id - b.team_id)
    const pinned = new Set(nations.map((n) => NATION_COLOUR_BY_NAME[n.nation_name]).filter(Boolean))
    const free = FALLBACK_COLOURS.filter((c) => !pinned.has(c))
    const pool = free.length ? free : FALLBACK_COLOURS
    let next = 0
    return new Map(
      nations.map((n) => [n.team_id, NATION_COLOUR_BY_NAME[n.nation_name] ?? pool[next++ % pool.length]]),
    )
  }, [standings.nations])

  const nationByCode = useMemo(
    () => new Map(standings.nations.map((n) => [n.territory_code, n])),
    [standings.nations],
  )

  const claimedCodes = useMemo(
    () => new Set(territories.territories.filter((t) => t.claimed).map((t) => t.territory_code)),
    [territories],
  )

  const events = useStatusEvents(standings)
  const activeCount = standings.nations.filter((n) => n.status === 'active').length
  const topScore = Math.max(1, ...standings.nations.map((n) => n.score))

  // Stable DOM order so rank changes animate as a slide rather than a re-render.
  const rows = useMemo(
    () => [...standings.nations].sort((a, b) => a.team_id - b.team_id),
    [standings.nations],
  )

  // Draw nations last so their glow and borders sit above neighbouring land.
  const countryCodes = useMemo(
    () => Object.keys(COUNTRIES).sort((a, b) => Number(nationByCode.has(a)) - Number(nationByCode.has(b))),
    [nationByCode],
  )

  return (
    <div className="warmap">
      <AmbientBackground />
      <header className="warmap__header">
        <div className="warmap__defcon">
          <span className="warmap__defcon-label">DEFCON</span>
          {/* Rounds count up but DEFCON counts down: round 1 is DEFCON 3, round 3 is DEFCON 1 */}
          <span className="warmap__defcon-level">{Math.max(1, Math.min(3, 4 - round.number))}</span>
        </div>
        <div className="warmap__round">
          <div className="warmap__game">{GAME_LABELS[round.game]}</div>
          <div className="warmap__meta">
            <span>Round {round.number}</span>
            <span className={`warmap__pill is-${standings.round_status}`}>{standings.round_status}</span>
            <span>
              <strong>{activeCount}</strong> / {standings.nations.length} nations standing
            </span>
          </div>
        </div>
        <div className="warmap__clock">
          <span className="warmap__live">
            <span className="warmap__live-dot" /> Live
          </span>
          <span className="warmap__clock-time">{formatClock(standings.server_time)} UTC</span>
        </div>
      </header>

      <main className="warmap__body">
        <section className="warmap__map" aria-label="World map">
          <div className="warmap__frame" style={{ ['--map-ratio' as string]: MAP_WIDTH / MAP_HEIGHT }}>
            <svg
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
            >
              <defs>
                <radialGradient id="warmap-ocean" cx="50%" cy="45%" r="75%">
                  <stop offset="0%" stopColor="#0F1C26" />
                  <stop offset="60%" stopColor="#0A141B" />
                  <stop offset="100%" stopColor="#060B0F" />
                </radialGradient>
                <pattern id="warmap-dq" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="#2A1218" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke="#E5253C" strokeWidth="1.6" />
                </pattern>
                {/* Tight halo: small blur at reduced alpha, with the crisp shape drawn on top. */}
                <filter id="warmap-glow" x="-10%" y="-10%" width="120%" height="120%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="blur" />
                  <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.7 0" result="glow" />
                  <feMerge>
                    <feMergeNode in="glow" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#warmap-ocean)" />

              {countryCodes.map((code) => {
                const shape = COUNTRIES[code]
                const nation = nationByCode.get(code)
                if (!nation) {
                  return (
                    <path
                      key={code}
                      d={shape.d}
                      className={`warmap__country ${claimedCodes.has(code) ? 'is-claimed-unranked' : ''}`}
                    >
                      <title>{shape.name}</title>
                    </path>
                  )
                }
                return (
                  <path
                    key={code}
                    d={shape.d}
                    className={`warmap__country is-nation is-${nation.status}`}
                    style={{ ['--nation' as string]: colourByTeam.get(nation.team_id) }}
                    filter={nation.status === 'active' ? 'url(#warmap-glow)' : undefined}
                  >
                    <title>{`${nation.nation_name} (${shape.name}) · #${nation.rank} · ${STATUS_LABELS[nation.status]}`}</title>
                  </path>
                )
              })}

              <Graticule />
              <TroopLayer
                movements={movements}
                nations={standings.nations}
                serverTime={standings.server_time}
                colourByTeam={colourByTeam}
                bursts={events}
              />
            </svg>
            <span className="warmap__corner is-tl" />
            <span className="warmap__corner is-tr" />
            <span className="warmap__corner is-bl" />
            <span className="warmap__corner is-br" />
          </div>

          <ol className="warmap__events" aria-live="polite">
            {events.map((e) => (
              <li key={e.id} className={`warmap__event is-${e.status}`}>{e.text}</li>
            ))}
          </ol>
        </section>

        <aside className="warmap__board" aria-label="Leaderboard">
          <h2 className="warmap__board-title">Standings</h2>
          <ol className="warmap__rows" style={{ height: rows.length * ROW_HEIGHT }}>
            {rows.map((n) => (
              <LeaderRow
                key={n.team_id}
                nation={n}
                colour={colourByTeam.get(n.team_id) ?? '#5A6472'}
                share={n.score / topScore}
              />
            ))}
          </ol>
        </aside>
      </main>
    </div>
  )
}

function LeaderRow({ nation, colour, share }: { nation: StandingsNation; colour: string; share: number }) {
  return (
    <li
      className={`warmap__row is-${nation.status} ${nation.rank === 1 ? 'is-leader' : ''}`}
      style={{ transform: `translateY(${(nation.rank - 1) * ROW_HEIGHT}px)`, ['--nation' as string]: colour }}
    >
      <span className="warmap__rank">{String(nation.rank).padStart(2, '0')}</span>
      <span className="warmap__swatch" />
      <span className="warmap__name">
        {nation.nation_name}
        <span className="warmap__code">{nation.territory_code}</span>
      </span>
      <span className="warmap__score">
        {nation.score.toLocaleString()}
        {nation.status !== 'active' && <span className="warmap__tag">{STATUS_LABELS[nation.status]}</span>}
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
function useStatusEvents(standings: StandingsResponse): WarEvent[] {
  const prev = useRef<Map<number, TeamStatus> | null>(null)
  const [events, setEvents] = useState<WarEvent[]>([])

  useEffect(() => {
    const before = prev.current
    const now = new Map(standings.nations.map((n) => [n.team_id, n.status]))
    prev.current = now
    if (!before) return

    // A full reset (scripted loop restarting) clears the log.
    if ([...now.values()].every((s) => s === 'active') && [...before.values()].some((s) => s !== 'active')) {
      setEvents([])
      return
    }

    const fresh: WarEvent[] = standings.nations
      .filter((n) => n.status !== 'active' && before.get(n.team_id) !== n.status)
      .map((n) => ({
        id: `${standings.server_time}-${n.team_id}`,
        status: n.status,
        territory_code: n.territory_code,
        text: n.status === 'eliminated'
          ? `${n.nation_name} has been eliminated`
          : `${n.nation_name} has been disqualified`,
      }))
    if (fresh.length) setEvents((list) => [...fresh, ...list].slice(0, 4))
  }, [standings])

  return events
}

function formatClock(iso: string) {
  return iso.slice(11, 19)
}
