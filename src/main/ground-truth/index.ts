import { createHash, randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import type {
  GroundTruthCapture,
  GroundTruthPage,
  GroundTruthSaveResult
} from '../../shared/contracts'
import { captureRoot, eventTimestamp } from '../capture/history/files'
import { readCaptureImage } from '../capture/history/images'
import { loadEvent, positiveInteger } from '../capture/history/metadata'
import {
  locateCapture,
  missing,
  requireLocation,
  saveMetadata,
  type CaptureLocation
} from './files'
import {
  groundTruthCapture,
  opaqueId,
  parseGroundTruthCommand,
  revision,
  updatedMetadata
} from './metadata'

const PAGE_SIZE = 20
interface Position {
  capturedAt: string
  eventId: string
}

function compare(left: Position, right: Position): number {
  return (
    Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
    left.eventId.localeCompare(right.eventId)
  )
}

export function createGroundTruthLibrary(roots: string[]) {
  if (!roots.length || roots.some((root) => typeof root !== 'string' || !root))
    throw new Error('A capture output directory is required.')
  const captureRoots = [...roots]
  const locations = new Map<string, CaptureLocation>()
  const cursors = new Map<string, Position>()
  const pending = new Map<string, Promise<unknown>>()

  function locationFor(input: unknown): CaptureLocation {
    const key = opaqueId(input, 'capture key')
    const location = locations.get(key)
    if (!location)
      throw new Error('Capture key is no longer available. Reload the ground truth library.')
    return location
  }

  function remember(location: CaptureLocation): string {
    const key = createHash('sha256').update(JSON.stringify(location)).digest('hex')
    locations.set(key, location)
    return key
  }

  async function read(input: unknown): Promise<GroundTruthCapture> {
    const location = locationFor(input)
    await requireLocation(location)
    const event = await loadEvent(location.root, location.eventId)
    await requireLocation(location)
    return groundTruthCapture(input as string, event)
  }

  return {
    read,
    async list(cursor: unknown = null): Promise<GroundTruthPage> {
      const after = cursor === null ? undefined : cursors.get(opaqueId(cursor, 'library cursor'))
      if (cursor !== null && !after) throw new Error('Library cursor expired. Reload the library.')
      const candidates = new Map<string, string>()
      let skippedEntries = 0
      for (const configuredRoot of captureRoots) {
        let root: string
        try {
          root = await captureRoot(configuredRoot)
        } catch (error) {
          if (missing(error)) continue
          throw error
        }
        for (const entry of await readdir(root, { withFileTypes: true })) {
          try {
            eventTimestamp(entry.name)
          } catch {
            skippedEntries++
            continue
          }
          // Reserve the preferred copy even when damaged. Never silently redirect its edits.
          if (!candidates.has(entry.name)) candidates.set(entry.name, root)
        }
      }
      const events: GroundTruthCapture[] = []
      let finalSecond: string | undefined
      for (const [eventId, root] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
        const second = eventId.slice(0, 15)
        if (after && second < after.eventId.slice(0, 15)) continue
        if (finalSecond !== undefined && second !== finalSecond) break
        try {
          const location = await locateCapture(root, eventId)
          const event = await loadEvent(root, eventId)
          await requireLocation(location)
          if (after && compare(event.summary, after) <= 0) continue
          events.push(groundTruthCapture(remember(location), event))
          // Finish the boundary second: filename suffixes are not millisecond ordering.
          if (events.length > PAGE_SIZE) finalSecond = second
        } catch {
          skippedEntries++
        }
      }
      events.sort(compare)
      let nextCursor: string | null = null
      if (events.length > PAGE_SIZE) {
        events.length = PAGE_SIZE
        nextCursor = randomBytes(32).toString('hex')
        const last = events[events.length - 1]
        cursors.set(nextCursor, { capturedAt: last.capturedAt, eventId: last.eventId })
      }
      return { events, nextCursor, skippedEntries }
    },
    async readImage(input: unknown, regionId: unknown): Promise<string> {
      const id = positiveInteger(regionId, 'ROI ID')
      const location = locationFor(input)
      await requireLocation(location)
      const image = await readCaptureImage(location.root, location.eventId, id)
      await requireLocation(location)
      return image
    },
    async save(input: unknown): Promise<GroundTruthSaveResult> {
      const command = parseGroundTruthCommand(input)
      const location = locationFor(command.captureKey)
      const preceding = pending.get(command.captureKey) ?? Promise.resolve()
      const operation = preceding
        .catch(() => undefined)
        .then(async () => {
          await requireLocation(location)
          const event = await loadEvent(location.root, location.eventId)
          if (revision(event.bytes) !== command.revision)
            throw new Error('Capture metadata changed. Reload this capture before saving again.')
          const next = updatedMetadata(event, command.regionId, command.text)
          const savedRevision = await saveMetadata(location, event.bytes, next)
          return { ...command, revision: savedRevision }
        })
      pending.set(command.captureKey, operation)
      try {
        return await operation
      } finally {
        if (pending.get(command.captureKey) === operation) pending.delete(command.captureKey)
      }
    }
  }
}
