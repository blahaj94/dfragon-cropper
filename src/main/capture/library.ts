import { mkdir } from 'node:fs/promises'
import type { CaptureHistory } from '../../shared/contracts'
import { listCaptures, readCaptureImage, resolveCaptureFolder } from './history'

/** Ordered roots preserve legacy history while preferring the current output directory. */
export function createCaptureLibrary(roots: string[]) {
  const captureRoots = [...roots]
  const captureRoot = captureRoots[0]
  if (!captureRoot) throw new Error('A capture output directory is required.')

  async function eventRoot(eventId: unknown): Promise<string> {
    if (typeof eventId !== 'string') throw new Error('A capture event ID is required.')
    for (const root of captureRoots) {
      try {
        await resolveCaptureFolder(root, eventId)
        return root
      } catch {
        // Older portable versions saved to .dev-captures; never move or delete their data.
      }
    }
    throw new Error('Capture event is invalid or no longer available.')
  }

  return {
    async list(): Promise<CaptureHistory> {
      const listings = await Promise.all(captureRoots.map((root) => listCaptures(root)))
      const unique = new Map<string, CaptureHistory['events'][number]>()
      for (const listing of listings) {
        for (const event of listing.events)
          if (!unique.has(event.eventId)) unique.set(event.eventId, event)
      }
      const events = [...unique.values()].sort(
        (a, b) =>
          Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || b.eventId.localeCompare(a.eventId)
      )
      return {
        events: events.slice(0, 100),
        skippedEntries: listings.reduce((total, item) => total + item.skippedEntries, 0),
        hasMore: events.length > 100 || listings.some((item) => item.hasMore)
      }
    },
    async readImage(eventId: unknown, regionId: unknown): Promise<string> {
      if (regionId !== null && (!Number.isSafeInteger(regionId) || (regionId as number) < 1)) {
        throw new Error('A positive ROI ID or null for the original is required.')
      }
      return readCaptureImage(
        await eventRoot(eventId),
        eventId as string,
        regionId as number | null
      )
    },
    async resolveFolder(eventId?: unknown): Promise<string> {
      if (eventId !== undefined) {
        const root = await eventRoot(eventId)
        return resolveCaptureFolder(root, eventId as string)
      }
      await mkdir(captureRoot, { recursive: true })
      return resolveCaptureFolder(captureRoot)
    }
  }
}
