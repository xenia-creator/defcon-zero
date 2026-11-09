/**
 * Small period details for the WWI dossier look. Purely decorative, plain CSS (src/index.css,
 * "Period details"), no images except paper.jpg. Each takes its ink from the surrounding text
 * colour, so it works on a .paper-sheet (type-* inks) and on .field-kit (paper, khaki, alert).
 */
import type { CSSProperties, ReactNode } from 'react'

/** A docket number, e.g. FILE 1983-RG: the prefix typed, the number in mono. */
export function FileNumber({ prefix = 'File', number, className = '' }: { prefix?: string; number: ReactNode; className?: string }) {
  return (
    <span className={`file-number ${className}`}>
      <span>{prefix}</span>
      <span className="file-number__no">{number}</span>
    </span>
  )
}

/**
 * A rubber stamp. Ink comes from a text-* class (text-type-red on paper, text-alert on dark).
 * `land` plays the stamp-land drop (which sets its own -8deg tilt); otherwise `tilt` in degrees.
 */
export function Stamp({
  children,
  tilt = -6,
  land = false,
  className = 'text-type-red',
}: {
  children: ReactNode
  tilt?: number
  land?: boolean
  className?: string
}) {
  return (
    <span className={`stamp inline-block ${land ? 'stamp-land' : ''} ${className}`} style={land ? undefined : { transform: `rotate(${tilt}deg)` }}>
      {children}
    </span>
  )
}

/** A censor's bar standing in for withheld words. Screen readers hear "redacted". */
export function RedactionBar({ width = 8, className = '' }: { width?: number; className?: string }) {
  return <span role="img" aria-label="redacted" className={`redaction ${className}`} style={{ '--redaction-w': `${width}ch` } as CSSProperties} />
}

/** A torn top edge for a paper sheet. Put it first inside a `.paper-sheet` that is `relative`. */
export function TornEdge({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`torn-edge ${className}`} />
}
