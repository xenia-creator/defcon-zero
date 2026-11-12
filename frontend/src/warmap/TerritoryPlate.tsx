import { COUNTRIES } from './worldPaths'

/**
 * One territory in its nation colour (--nation on an ancestor), its neighbours faint around it for
 * context. Strokes stay a fixed width however far the crop zooms in. The viewBox comes from
 * territoryCrop. Used by the board's winner banner (WarMap.tsx) and the winner flash (WinnerFlash.tsx).
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
