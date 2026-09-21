import { describe, expect, it } from 'vitest'
import { selectionRectangle } from '../../src/renderer/src/selection'

describe('physical pixel selection', () => {
  const frame = { width: 1920, height: 1080 }
  it('maps screen image coordinates at 100% and 150% display size to the same physical ROI', () => {
    for (const scale of [1, 1.5]) {
      expect(
        selectionRectangle(
          { x: 10 + 120 * scale, y: 20 + 80 * scale },
          { x: 10 + 400 * scale, y: 20 + 300 * scale },
          { left: 10, top: 20, width: 1920 * scale, height: 1080 * scale },
          frame
        )
      ).toEqual({ x: 120, y: 80, width: 280, height: 220 })
    }
  })
  it('rounds outward for scaled fractional edges and supports reversed drags', () => {
    const bounds = { left: 0, top: 0, width: 960, height: 540 }
    const a = { x: 10.2, y: 20.2 }
    const b = { x: 30.7, y: 50.7 }
    expect(selectionRectangle(a, b, bounds, frame)).toEqual({ x: 20, y: 40, width: 42, height: 62 })
    expect(selectionRectangle(b, a, bounds, frame)).toEqual(selectionRectangle(a, b, bounds, frame))
  })
  it('clamps to the image edges and ignores zero-area clicks or wholly outside drags', () => {
    const bounds = { left: 10, top: 20, width: 960, height: 540 }
    expect(selectionRectangle({ x: -50, y: -50 }, { x: 2000, y: 2000 }, bounds, frame)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
    expect(selectionRectangle({ x: 10.25, y: 30 }, { x: 10.25, y: 80 }, bounds, frame)).toBeNull()
    expect(selectionRectangle({ x: -50, y: -50 }, { x: -20, y: -20 }, bounds, frame)).toBeNull()
  })
  it('rejects unusable dimensions and non-finite pointer input', () => {
    const bounds = { left: 0, top: 0, width: 960, height: 540 }
    expect(selectionRectangle({ x: 0, y: 0 }, { x: Infinity, y: 10 }, bounds, frame)).toBeNull()
    expect(
      selectionRectangle({ x: 0, y: 0 }, { x: 10, y: 10 }, { ...bounds, width: 0 }, frame)
    ).toBeNull()
    expect(
      selectionRectangle({ x: 0, y: 0 }, { x: 10, y: 10 }, bounds, { width: 12.5, height: 20 })
    ).toBeNull()
  })
})
