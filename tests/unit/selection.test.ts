import { describe, expect, it } from 'vitest'
import {
  selectionRectangle,
  sourcePoint,
  type ImageBounds,
  type Point
} from '../../src/renderer/src/selection'

describe('physical pixel selection', () => {
  const frame = { width: 1920, height: 1080 }
  const select = (start: Point, end: Point, bounds: ImageBounds) =>
    selectionRectangle(sourcePoint(start, bounds, frame)!, sourcePoint(end, bounds, frame)!, frame)

  it('maps synthetic presentation scales to the same physical ROI', () => {
    for (const scale of [1, 1.5]) {
      expect(
        select(
          { x: 10 + 120 * scale, y: 20 + 80 * scale },
          { x: 10 + 400 * scale, y: 20 + 300 * scale },
          { left: 10, top: 20, width: 1920 * scale, height: 1080 * scale }
        )
      ).toEqual({ x: 120, y: 80, width: 280, height: 220 })
    }
  })
  it('rounds outward for scaled fractional edges and supports reversed drags', () => {
    const bounds = { left: 0, top: 0, width: 960, height: 540 }
    const a = { x: 10.2, y: 20.2 }
    const b = { x: 30.7, y: 50.7 }
    expect(select(a, b, bounds)).toEqual({ x: 20, y: 40, width: 42, height: 62 })
    expect(select(b, a, bounds)).toEqual(select(a, b, bounds))
  })
  it('clamps to the image edges and ignores zero-area clicks or wholly outside drags', () => {
    const bounds = { left: 10, top: 20, width: 960, height: 540 }
    expect(select({ x: -50, y: -50 }, { x: 2000, y: 2000 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
    expect(select({ x: 10.25, y: 30 }, { x: 10.25, y: 80 }, bounds)).toBeNull()
    expect(select({ x: -50, y: -50 }, { x: -20, y: -20 }, bounds)).toBeNull()
  })
  it('rejects unusable dimensions and non-finite pointer or source input', () => {
    const bounds = { left: 0, top: 0, width: 960, height: 540 }
    expect(sourcePoint({ x: Infinity, y: 10 }, bounds, frame)).toBeNull()
    expect(sourcePoint({ x: 10, y: 10 }, { ...bounds, width: 0 }, frame)).toBeNull()
    expect(sourcePoint({ x: 10, y: 10 }, bounds, { width: 12.5, height: 20 })).toBeNull()
    expect(selectionRectangle({ x: 0, y: 0 }, { x: NaN, y: 10 }, frame)).toBeNull()
    expect(
      selectionRectangle({ x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 10 })
    ).toBeNull()
  })
  it('keeps the starting source pixel when scrolling moves the image during a drag', () => {
    const before = { left: 10, top: 200, width: 960, height: 540 }
    const after = { ...before, top: 80 }
    const start = sourcePoint({ x: 70, y: 240 }, before, frame)!
    const end = sourcePoint({ x: 210, y: 230 }, after, frame)!
    expect(selectionRectangle(start, end, frame)).toEqual({
      x: 120,
      y: 80,
      width: 280,
      height: 220
    })
  })
  it('keeps fractional starting edges for a reverse drag after the image resizes', () => {
    const start = sourcePoint(
      { x: 40.7, y: 70.7 },
      { left: 10, top: 20, width: 960, height: 540 },
      frame
    )!
    const end = sourcePoint(
      { x: 130.6, y: 140.6 },
      { left: 100, top: 80, width: 2880, height: 1620 },
      frame
    )!
    expect(start.x).toBeCloseTo(61.4)
    expect(start.y).toBeCloseTo(101.4)
    expect(selectionRectangle(start, end, frame)).toEqual({ x: 20, y: 40, width: 42, height: 62 })
  })
  it('clamps the endpoint against its current bounds after a resize', () => {
    const start = sourcePoint(
      { x: 70, y: 60 },
      { left: 10, top: 20, width: 960, height: 540 },
      frame
    )!
    const end = sourcePoint(
      { x: 4000, y: -1 },
      { left: 100, top: 80, width: 2880, height: 1620 },
      frame
    )!
    expect(selectionRectangle(start, end, frame)).toEqual({ x: 120, y: 0, width: 1800, height: 80 })
  })
})
