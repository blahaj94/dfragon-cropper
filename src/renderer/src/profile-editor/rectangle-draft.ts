import type { Region } from '../../../shared/contracts'
import { userError } from '../errors'

export type Rectangle = Omit<Region, 'id'>
export type RectangleDraft = Record<keyof Rectangle, string>
export type PreviewDraft = { rectangle: Rectangle | null; dirty: boolean; error: string | null }

export const emptyRectangle: RectangleDraft = { x: '0', y: '0', width: '100', height: '100' }
export const rectangleFields = ['x', 'y', 'width', 'height'] as const

export const draftFrom = (region: Rectangle): RectangleDraft => ({
  x: String(region.x),
  y: String(region.y),
  width: String(region.width),
  height: String(region.height)
})

export function rectangleFrom(draft: RectangleDraft): Rectangle {
  const rectangle = Object.fromEntries(
    rectangleFields.map((field) => [field, Number(draft[field])])
  ) as Rectangle
  if (
    rectangleFields.some(
      (field) =>
        draft[field].trim() === '' ||
        !Number.isSafeInteger(rectangle[field]) ||
        rectangle[field] < (field === 'x' || field === 'y' ? 0 : 1)
    )
  ) {
    throw new Error('Enter whole pixels: X and Y must be at least 0; width and height at least 1.')
  }
  return rectangle
}

export function previewDraft(draft: RectangleDraft, saved: Region): PreviewDraft {
  const dirty = rectangleFields.some((field) => draft[field] !== String(saved[field]))
  try {
    return { rectangle: rectangleFrom(draft), dirty, error: null }
  } catch (reason) {
    return { rectangle: null, dirty, error: userError(reason) }
  }
}
