import { useEffect, useRef, useState } from 'react'
import { COUNTRIES } from './worldPaths'
import type { StandingsNation, TroopMovement } from './types'

// Animated overlay: troop arcs, impact shockwaves and elimination bursts.
// Purely presentational; it only reads movements and standings.

interface Flight {
  key: string
  from: [number, number]
  to: [number, number]
  targetCode: string
  colour: string
  troops: number
}

interface Impact {
  key: string
  at: [number, number]
  targetCode: string
  colour: string
}

export interface Burst {
  id: string
  territory_code: string
}

interface TroopLayerProps {
  movements: TroopMovement[]
  nations: StandingsNation[]
  serverTime: string
  colourByTeam: Map<number, string>
  bursts: Burst[]
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function TroopLayer({ movements, nations, serverTime, colourByTeam, bursts }: TroopLayerProps) {
  const [flights, setFlights] = useState<Flight[]>([])
  const [impacts, setImpacts] = useState<Impact[]>([])
  // Latest lookups without re-scheduling launches on every standings change.
  const ctx = useRef({ nations, serverTime, colourByTeam })
  useEffect(() => {
    ctx.current = { nations, serverTime, colourByTeam }
  })

  // Schedule each movement relative to the poll's server_time.
  useEffect(() => {
    const { nations, serverTime, colourByTeam } = ctx.current
    const codeByTeam = new Map(nations.map((n) => [n.team_id, n.territory_code]))
    const base = Date.parse(serverTime)
    const timers = movements.flatMap((m) => {
      const fromCode = codeByTeam.get(m.from_team_id)
      const toCode = codeByTeam.get(m.to_team_id)
      const from = fromCode && COUNTRIES[fromCode]
      const to = toCode && COUNTRIES[toCode]
      if (!from || !to || !toCode) return []
      const flight: Flight = {
        key: m.id,
        from: from.anchor,
        to: to.anchor,
        targetCode: toCode,
        colour: colourByTeam.get(m.from_team_id) ?? '#FFFFFF',
        troops: m.troops,
      }
      const delay = Math.max(0, Math.min(2000, Date.parse(m.launched_at) - base))
      return [window.setTimeout(() => setFlights((list) => [...list, flight]), delay)]
    })
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [movements])

  const land = (f: Flight) => {
    setFlights((list) => list.filter((x) => x.key !== f.key))
    const impact = { key: f.key, at: f.to, targetCode: f.targetCode, colour: f.colour }
    setImpacts((list) => [...list, impact])
    window.setTimeout(() => setImpacts((list) => list.filter((x) => x.key !== impact.key)), 900)
  }

  return (
    <g className="warmap__troops" aria-hidden="true">
      {bursts.map((b) => {
        const shape = COUNTRIES[b.territory_code]
        if (!shape) return null
        const [x, y] = shape.anchor
        return (
          <g key={b.id} className="warmap__burst">
            <path d={shape.d} className="warmap__burst-flash" />
            <circle cx={x} cy={y} r={34} className="warmap__burst-ring" />
            <circle cx={x} cy={y} r={34} className="warmap__burst-ring is-late" />
            {Array.from({ length: 10 }, (_, i) => {
              const a = (i / 10) * Math.PI * 2
              return (
                <line key={i} x1={x + Math.cos(a) * 6} y1={y + Math.sin(a) * 6}
                  x2={x + Math.cos(a) * 22} y2={y + Math.sin(a) * 22} className="warmap__burst-spark" />
              )
            })}
          </g>
        )
      })}
      {impacts.map((i) => (
        <g key={i.key} className="warmap__impact" style={{ ['--nation' as string]: i.colour }}>
          <path d={COUNTRIES[i.targetCode].d} className="warmap__impact-flash" />
          <circle cx={i.at[0]} cy={i.at[1]} r={14} className="warmap__impact-ring" />
          <circle cx={i.at[0]} cy={i.at[1]} r={2.5} className="warmap__impact-core" />
        </g>
      ))}
      {flights.map((f) => (
        <TroopArc key={f.key} flight={f} onLand={land} />
      ))}
    </g>
  )
}

function TroopArc({ flight, onLand }: { flight: Flight; onLand: (f: Flight) => void }) {
  const head = useRef<SVGGElement>(null)
  const trail = useRef<SVGPathElement>(null)
  const landRef = useRef(onLand)
  useEffect(() => {
    landRef.current = onLand
  })

  const [x0, y0] = flight.from
  const [x1, y1] = flight.to
  const dist = Math.hypot(x1 - x0, y1 - y0)
  // Control point lifted above the midpoint so arcs bow like flight paths.
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2 - Math.min(120, dist * 0.35)
  const d = `M${x0} ${y0}Q${cx} ${cy} ${x1} ${y1}`

  useEffect(() => {
    const duration = reducedMotion() ? 1 : Math.min(2200, 900 + dist * 2.2)
    const point = (s: number): [number, number] => {
      const u = 1 - s
      return [u * u * x0 + 2 * u * s * cx + s * s * x1, u * u * y0 + 2 * u * s * cy + s * s * y1]
    }
    // The trail is revealed by distance along the path (pathLength=1), but the Bezier
    // parameter does not advance at constant speed. Map distance -> parameter with a
    // cumulative arc-length table so the head sits exactly on the trail's tip.
    const SAMPLES = 64
    const lengths = [0]
    let prev = point(0)
    for (let i = 1; i <= SAMPLES; i++) {
      const p = point(i / SAMPLES)
      lengths.push(lengths[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]))
      prev = p
    }
    const total = lengths[SAMPLES] || 1
    const paramAt = (fraction: number) => {
      const target = fraction * total
      let i = 1
      while (i < SAMPLES && lengths[i] < target) i++
      const span = lengths[i] - lengths[i - 1] || 1
      return (i - 1 + (target - lengths[i - 1]) / span) / SAMPLES
    }

    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const [x, y] = point(paramAt(e))
      head.current?.setAttribute('transform', `translate(${x} ${y})`)
      trail.current?.setAttribute('stroke-dashoffset', String(1 - e))
      if (t < 1) frame = requestAnimationFrame(step)
      else landRef.current(flight)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [flight, dist, x0, y0, x1, y1, cx, cy])

  return (
    <g className="warmap__arc" style={{ ['--nation' as string]: flight.colour }}>
      <path d={d} className="warmap__arc-guide" pathLength={1} />
      <path ref={trail} d={d} className="warmap__arc-trail" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1} />
      <g ref={head} transform={`translate(${x0} ${y0})`}>
        <circle r={2.6} className="warmap__arc-head" />
        <text y={-6} className="warmap__arc-label">{formatTroops(flight.troops)}</text>
      </g>
    </g>
  )
}

function formatTroops(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
