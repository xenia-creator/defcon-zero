// A single territory drawn large (the winner reveal and banner): the map's own outline, with the
// view cropped to the landmass the territory's anchor sits on, so far-flung islands and overseas
// parts (Alaska and Hawaii for US, French Guiana for FR) don't shrink the main land to a speck.
// Pure, so it is unit-tested. worldPaths outlines are absolute M/L/Z only.
import type { MapTerritory } from './types'
import { COUNTRIES, type CountryShape } from './worldPaths'

type Point = readonly [number, number]

export interface TerritoryCrop {
  /** The territory's display name, from the map data. */
  name: string
  /** The whole outline, as on the map; the view does the cropping. */
  d: string
  /** "x y width height" in map units: the anchored landmass with padding around it. */
  viewBox: string
}

/** Space around the landmass, as a share of its larger side. */
const PAD = 0.18
/** The smallest view, in map units, so a small country isn't blown up into jagged 1:110m polygons. */
const MIN_SPAN = 28

/** Each closed outline (one per M ... Z) of an absolute M/L/Z path, as its points. */
export function outlines(d: string): Point[][] {
  return d
    .split(/(?=M)/)
    .map((part) => {
      const nums = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      const points: Point[] = []
      for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]])
      return points
    })
    .filter((points) => points.length >= 3)
}

/** Ray casting: whether the point lies inside the polygon. */
function contains(polygon: readonly Point[], [x, y]: Point): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function bounds(points: readonly Point[]) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * The crop for a territory code, or null when the map has no shape for it (the caller then shows
 * the code and name only). The landmass is the outline containing the anchor; failing that (an
 * anchor just off a concave coast), the smallest outline whose box holds it; failing that, the
 * largest outline.
 */
export function territoryCrop(code: string, countries: Record<string, CountryShape> = COUNTRIES): TerritoryCrop | null {
  const shape = countries[code]
  if (!shape) return null
  const parts = outlines(shape.d)
  if (parts.length === 0) return null

  const boxes = parts.map(bounds)
  const area = (i: number) => boxes[i].width * boxes[i].height
  const indexes = parts.map((_, i) => i)
  const [ax, ay] = shape.anchor
  const inBox = (i: number) => ax >= boxes[i].minX && ax <= boxes[i].minX + boxes[i].width && ay >= boxes[i].minY && ay <= boxes[i].minY + boxes[i].height
  const pick =
    indexes.find((i) => contains(parts[i], shape.anchor)) ??
    indexes.filter(inBox).sort((a, b) => area(a) - area(b))[0] ??
    indexes.sort((a, b) => area(b) - area(a))[0]

  const box = boxes[pick]
  const span = Math.max(box.width, box.height)
  const pad = span * PAD
  // Grow each side to at least MIN_SPAN, keeping the landmass centred
  const width = Math.max(box.width + pad * 2, MIN_SPAN)
  const height = Math.max(box.height + pad * 2, MIN_SPAN)
  const x = box.minX + box.width / 2 - width / 2
  const y = box.minY + box.height / 2 - height / 2
  return { name: shape.name, d: shape.d, viewBox: [x, y, width, height].map(round1).join(' ') }
}

/** A territory's display name: the map's own, else GET /territories, else the code. */
export function territoryName(code: string, territories: readonly MapTerritory[]): string {
  return COUNTRIES[code]?.name ?? territories.find((t) => t.territory_code === code)?.name ?? code
}
