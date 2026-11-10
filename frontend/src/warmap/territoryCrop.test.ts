import { describe, expect, it } from 'vitest'
import { outlines, territoryCrop } from './territoryCrop'
import { COUNTRIES, MAP_WIDTH } from './worldPaths'

const viewBox = (s: string) => s.split(' ').map(Number) as [number, number, number, number]

// A mainland 100x50 at (100,100) and a small island far away at (400,400)
const MAINLAND = 'M100 100L200 100L200 150L100 150Z'
const ISLAND = 'M400 400L410 400L410 410L400 410Z'
const fake = (anchor: [number, number], d = `${ISLAND}${MAINLAND}`) => ({ XX: { name: 'Testland', anchor, d } })

describe('outlines', () => {
  it('splits an absolute M/L/Z path into one point list per outline', () => {
    expect(outlines(`${MAINLAND}${ISLAND}`)).toEqual([
      [[100, 100], [200, 100], [200, 150], [100, 150]],
      [[400, 400], [410, 400], [410, 410], [400, 410]],
    ])
  })

  it('reads decimals', () => {
    expect(outlines('M1.5 2.25L3 4L5.75 6Z')).toEqual([[[1.5, 2.25], [3, 4], [5.75, 6]]])
  })
})

describe('territoryCrop', () => {
  it('is null when the map has no shape for the code', () => {
    expect(territoryCrop('ZZ')).toBeNull()
    expect(territoryCrop('XX', {})).toBeNull()
  })

  it('crops to the outline containing the anchor, with padding, ignoring far-off islands', () => {
    const crop = territoryCrop('XX', fake([150, 125]))!
    expect(crop.name).toBe('Testland')
    // 18% of the larger side (100) on every side: 136 x 86, centred on the mainland
    expect(viewBox(crop.viewBox)).toEqual([82, 82, 136, 86])
    expect(crop.d).toBe(`${ISLAND}${MAINLAND}`) // the whole outline is drawn; the view crops it
  })

  it('crops to the island when the anchor is on the island', () => {
    const [x, y, w, h] = viewBox(territoryCrop('XX', fake([405, 405]))!.viewBox)
    expect(x).toBeLessThan(400)
    expect(y).toBeLessThan(400)
    expect(x + w).toBeGreaterThan(410)
    expect(w).toBeLessThan(40)
    expect(h).toBeLessThan(40)
  })

  it('falls back to the box holding the anchor, then to the largest outline', () => {
    // A U-shaped coast whose anchor sits in the bay: outside the polygon, inside its box
    const bay = 'M0 0L30 0L30 30L20 30L20 10L10 10L10 30L0 30Z'
    const [bx, , bw] = viewBox(territoryCrop('XX', fake([15, 20], `${MAINLAND}${bay}`))!.viewBox)
    expect(bx).toBeLessThan(0)
    expect(bx + bw).toBeGreaterThan(30)
    expect(bw).toBeLessThan(60)
    // Anchor out at sea: the mainland, the bigger of the two
    expect(viewBox(territoryCrop('XX', fake([700, 700]))!.viewBox)).toEqual([82, 82, 136, 86])
  })

  it('never crops tighter than the minimum view, keeping the land centred', () => {
    const [x, y, w, h] = viewBox(territoryCrop('XX', fake([405, 405], ISLAND))!.viewBox)
    expect([w, h]).toEqual([28, 28])
    expect(x + w / 2).toBe(405)
    expect(y + h / 2).toBe(405)
  })

  it('crops real countries to their main land: US without Alaska, Russia sensible, every map country has a crop', () => {
    const us = viewBox(territoryCrop('US')!.viewBox)
    const alaskaX = 50 // Alaska lies far west of the lower 48 (x well under 150)
    expect(us[0]).toBeGreaterThan(alaskaX)
    expect(us[2]).toBeLessThan(MAP_WIDTH / 3)
    const ru = viewBox(territoryCrop('RU')!.viewBox)
    expect(ru[2]).toBeGreaterThan(100)
    for (const code of Object.keys(COUNTRIES)) {
      const [, , w, h] = viewBox(territoryCrop(code)!.viewBox)
      expect(w).toBeGreaterThan(0)
      expect(h).toBeGreaterThan(0)
    }
  })
})
