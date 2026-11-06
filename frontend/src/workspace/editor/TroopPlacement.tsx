import { useMemo, useState } from 'react'
import { COUNTRIES, MAP_HEIGHT, MAP_WIDTH } from '../../warmap/worldPaths'
import { COUNTRY_FRONT, FRONTS, evenAllocation, labelPoint, regionNames } from './troops'

/** Whole troops, never below 0: what the boxes and arrows can set. */
const clean = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)

/**
 * Round 2 on the map: split the troops across the fronts. Click a front (on the map or
 * in the list) and set its troops with the arrows or by typing. Shift+arrow moves 10.
 */
export function TroopPlacement({
  troops,
  regions,
  allocation,
  onChange,
  problems,
  disabled = false,
}: {
  troops: number
  regions: number
  allocation: number[]
  onChange: (next: number[]) => void
  problems: string[]
  disabled?: boolean
}) {
  const [selected, setSelected] = useState(0)
  const names = regionNames(regions)
  const onMap = regions === FRONTS.length
  const placed = allocation.reduce((sum, n) => sum + n, 0)
  const valid = problems.length === 0
  const set = (i: number, value: number) => onChange(allocation.map((n, j) => (j === i ? clean(value) : n)))
  const step = (i: number, by: number) => set(i, (allocation[i] ?? 0) + by)

  // Countries drawn once per front, so a click anywhere in a front selects it
  const countries = useMemo(() => Object.entries(COUNTRIES).map(([code, shape]) => ({ code, d: shape.d, front: COUNTRY_FRONT.get(code) ?? 0 })), [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-steel bg-ink/60 px-4 py-2">
        <span className="label !text-paper">Place your troops</span>
        <span data-testid="troops-placed" className={`font-bold tabular-nums ${valid ? 'text-coop' : placed > troops ? 'text-alert' : 'text-amber'}`}>
          {placed} / {troops} troops placed
        </span>
        <span className="ml-auto flex gap-2">
          <button type="button" disabled={disabled} onClick={() => onChange(evenAllocation(troops, regions))} className="label cursor-pointer border border-steel px-2 py-1 !text-[10px] hover:!text-paper disabled:cursor-not-allowed">
            Spread evenly
          </button>
          <button type="button" disabled={disabled} onClick={() => onChange(allocation.map(() => 0))} className="label cursor-pointer border border-steel px-2 py-1 !text-[10px] hover:!text-alert disabled:cursor-not-allowed">
            Clear
          </button>
        </span>
      </div>

      {onMap && (
        <div className="relative min-h-0 flex-1 bg-[#060b0f]">
          <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" role="group" aria-label="War map: click a front to place troops">
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0a141b" />
            {countries.map(({ code, d, front }) => (
              <path
                key={code}
                d={d}
                fill={FRONTS[front].colour}
                fillOpacity={front === selected ? 0.55 : allocation[front] > 0 ? 0.3 : 0.14}
                stroke={front === selected ? FRONTS[front].colour : '#0a1014'}
                strokeWidth={front === selected ? 0.9 : 0.5}
                className="cursor-pointer transition-[fill-opacity] duration-200"
                onClick={() => setSelected(front)}
              />
            ))}
            {FRONTS.map((front, i) => {
              const [x, y] = labelPoint(front)
              const active = i === selected
              return (
                <g key={front.name} transform={`translate(${x} ${y})`} className="cursor-pointer" onClick={() => setSelected(i)}>
                  <rect x={-62} y={-24} width={124} height={44} rx={2} fill="#0b0f12" fillOpacity={0.88} stroke={front.colour} strokeWidth={active ? 2 : 1} />
                  <text y={-8} textAnchor="middle" fontSize={10} letterSpacing="0.12em" fill={front.colour} style={{ textTransform: 'uppercase', fontWeight: 700 }}>
                    {i + 1}. {front.name}
                  </text>
                  <text y={13} textAnchor="middle" fontSize={18} fontWeight={700} fill="#ffffff">
                    {allocation[i] ?? 0}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      )}

      <ol className={`grid shrink-0 gap-px border-t border-steel bg-steel/40 ${onMap ? 'grid-cols-1 sm:grid-cols-5' : 'grid-cols-1'}`} aria-label="Troops per region">
        {names.map((name, i) => {
          const colour = onMap ? FRONTS[i].colour : '#F5A526'
          const active = i === selected
          return (
            <li key={name} className={`flex flex-col gap-2 p-3 ${active ? 'bg-panel' : 'bg-ink/80'}`} style={{ boxShadow: active ? `inset 0 2px 0 ${colour}` : undefined }} onClick={() => setSelected(i)}>
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase" style={{ color: colour }}>
                <span className="h-2 w-2" style={{ background: colour }} />
                {i + 1}. {name}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Fewer troops in ${name}`}
                  title="Shift-click to move 10"
                  disabled={disabled || (allocation[i] ?? 0) <= 0}
                  onClick={(e) => step(i, e.shiftKey ? -10 : -1)}
                  className="h-8 w-8 cursor-pointer border border-steel text-muted hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ▼
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={troops}
                  step={1}
                  aria-label={`Troops in ${name}`}
                  disabled={disabled}
                  value={allocation[i] ?? 0}
                  onFocus={() => setSelected(i)}
                  onChange={(e) => set(i, e.target.value === '' ? 0 : Number(e.target.value))}
                  className="h-8 w-16 border border-steel bg-ink text-center font-bold tabular-nums text-paper outline-none focus:border-amber"
                />
                <button
                  type="button"
                  aria-label={`More troops in ${name}`}
                  title="Shift-click to move 10"
                  disabled={disabled || placed >= troops}
                  onClick={(e) => step(i, e.shiftKey ? Math.min(10, troops - placed) : 1)}
                  className="h-8 w-8 cursor-pointer border border-steel text-muted hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ▲
                </button>
              </span>
              <span className="h-1 bg-steel/60">
                <span className="block h-full" style={{ width: `${troops ? Math.min(100, ((allocation[i] ?? 0) / troops) * 100) : 0}%`, background: colour }} />
              </span>
            </li>
          )
        })}
      </ol>

      <div className="shrink-0 border-t border-steel bg-ink/80 px-4 py-2 text-xs" role="status">
        {valid ? (
          <span className="text-coop">All {troops} troops placed. This split plays every turn: submit it to lock it in.</span>
        ) : (
          problems.map((p) => (
            <p key={p} className="text-amber">
              {p}
            </p>
          ))
        )}
      </div>
    </div>
  )
}
