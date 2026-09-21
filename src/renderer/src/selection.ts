import type { Region } from '../../shared/contracts'

export interface Point {
  x: number
  y: number
}
export interface ImageBounds {
  left: number
  top: number
  width: number
  height: number
}

/** Display scaling affects pointer projection only; the source PNG is never resized. */
export function selectionRectangle(
  start: Point,
  end: Point,
  bounds: ImageBounds,
  frame: { width: number; height: number }
): Omit<Region, 'id'> | null {
  if (
    ![start.x, start.y, end.x, end.y, bounds.left, bounds.top, bounds.width, bounds.height].every(
      Number.isFinite
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  )
    return null
  const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value))
  const ax = clamp((start.x - bounds.left) / bounds.width, 1) * frame.width
  const ay = clamp((start.y - bounds.top) / bounds.height, 1) * frame.height
  const bx = clamp((end.x - bounds.left) / bounds.width, 1) * frame.width
  const by = clamp((end.y - bounds.top) / bounds.height, 1) * frame.height
  if (ax === bx || ay === by) return null
  const x = Math.floor(Math.min(ax, bx))
  const y = Math.floor(Math.min(ay, by))
  return { x, y, width: Math.ceil(Math.max(ax, bx)) - x, height: Math.ceil(Math.max(ay, by)) - y }
}
