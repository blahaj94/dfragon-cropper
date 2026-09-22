/** Persisted ROI naming is shared by the event writer and history readers. */
export function roiFilename(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ROI ID must be a positive integer.')
  return `${String(id).padStart(3, '0')}.png`
}
