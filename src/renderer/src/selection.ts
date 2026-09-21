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

type FrameSize = { width: number; height: number }

const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value))
const validFrame = (frame: FrameSize) =>
  Number.isSafeInteger(frame.width) &&
  Number.isSafeInteger(frame.height) &&
  frame.width > 0 &&
  frame.height > 0

/** Keep fractional source coordinates so a later scroll/resize cannot move the drag origin. */
export function sourcePoint(point: Point, bounds: ImageBounds, frame: FrameSize): Point | null {
  if (
    ![point.x, point.y, bounds.left, bounds.top, bounds.width, bounds.height].every(
      Number.isFinite
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !validFrame(frame)
  )
    return null
  return {
    x: clamp((point.x - bounds.left) / bounds.width, 1) * frame.width,
    y: clamp((point.y - bounds.top) / bounds.height, 1) * frame.height
  }
}

/** Round only the final source-space edges; display scaling never resizes the source PNG. */
export function selectionRectangle(
  start: Point,
  end: Point,
  frame: FrameSize
): Omit<Region, 'id'> | null {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || !validFrame(frame)) return null
  const ax = clamp(start.x, frame.width)
  const ay = clamp(start.y, frame.height)
  const bx = clamp(end.x, frame.width)
  const by = clamp(end.y, frame.height)
  if (ax === bx || ay === by) return null
  const x = Math.floor(Math.min(ax, bx))
  const y = Math.floor(Math.min(ay, by))
  return { x, y, width: Math.ceil(Math.max(ax, bx)) - x, height: Math.ceil(Math.max(ay, by)) - y }
}
