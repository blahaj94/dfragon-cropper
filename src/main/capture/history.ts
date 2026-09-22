import { readdir } from 'node:fs/promises'
import type { CaptureHistory, CaptureSummary } from '../../shared/contracts'
import { captureRoot, eventTimestamp } from './history/files'
import { loadEvent } from './history/metadata'

export { readCaptureImage } from './history/images'

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function listCaptures(outputRoot: string): Promise<CaptureHistory> {
  let root: string
  try {
    root = await captureRoot(outputRoot)
  } catch (error) {
    if (missing(error)) return { events: [], skippedEntries: 0, hasMore: false }
    throw error
  }
  const entries = await readdir(root, { withFileTypes: true })
  entries.sort((left, right) => right.name.localeCompare(left.name))
  const events: CaptureSummary[] = []
  let validEntries = 0
  let skippedEntries = 0
  let finalTimestamp: string | undefined
  for (const entry of entries) {
    // IDs sort by UTC second, but their suffixes do not sort by milliseconds. Once
    // there is evidence of a 101st event, finish that second before stopping I/O.
    if (finalTimestamp !== undefined && entry.name.slice(0, 15) !== finalTimestamp) break
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error('Not a capture directory.')
      const event = await loadEvent(root, entry.name)
      events.push(event.summary)
      validEntries++
      if (validEntries === 101) finalTimestamp = entry.name.slice(0, 15)
      // Retain only the requested window even when the local archive contains many events.
      events.sort(
        (left, right) =>
          Date.parse(right.capturedAt) - Date.parse(left.capturedAt) ||
          right.eventId.localeCompare(left.eventId)
      )
      if (events.length > 100) events.pop()
    } catch {
      // This counts damaged entries inspected in this scan, not the whole archive.
      skippedEntries++
    }
  }
  return { events, skippedEntries, hasMore: validEntries > 100 }
}

export async function resolveCaptureFolder(outputRoot: string, eventId?: string): Promise<string> {
  if (eventId !== undefined) eventTimestamp(eventId)
  const root = await captureRoot(outputRoot)
  return eventId === undefined ? root : (await loadEvent(root, eventId)).folder
}
