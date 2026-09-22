import { join } from 'node:path'
import type { CaptureSummary } from '../../../shared/contracts'
import { validateRegions } from '../pixels'
import { roiFilename } from '../filenames'
import { eventFolder, eventTimestamp, imageFile, readLimited } from './files'

export const MAX_METADATA_BYTES = 1024 * 1024

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid capture metadata object.')
  return value as Record<string, unknown>
}

export function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`)
  }
  return value
}

function text(value: unknown, label: string, maximum = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error(`Invalid ${label}.`)
  return value
}

interface HistoryEvent {
  summary: CaptureSummary
  folder: string
  metadata: Record<string, unknown>
  bytes: Buffer
}

export async function loadEvent(root: string, eventId: string): Promise<HistoryEvent> {
  const timestamp = eventTimestamp(eventId)
  const folder = await eventFolder(root, eventId)
  const bytes = await readLimited(folder, 'metadata.json', MAX_METADATA_BYTES)
  const metadata = record(JSON.parse(bytes.toString('utf8')))
  if (
    metadata.schemaVersion !== 1 ||
    metadata.eventId !== eventId ||
    metadata.coordinateSpace !== 'primary-monitor-physical-pixels'
  ) {
    throw new Error('Capture metadata does not match its event or supported schema.')
  }
  const capturedAt = text(metadata.capturedAt, 'capture timestamp', 40)
  const date = new Date(capturedAt)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== timestamp) {
    throw new Error('Capture timestamp does not match its event ID.')
  }
  const trigger = text(metadata.trigger, 'capture trigger')
  const source = record(metadata.source)
  const width = positiveInteger(source.width, 'Source width')
  const height = positiveInteger(source.height, 'Source height')
  if (
    !Number.isSafeInteger(width * height * 4) ||
    source.pixelFormat !== 'rgba8' ||
    (source.backend !== 'win32-gdi' && source.backend !== 'fixture') ||
    typeof source.rgbaSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.rgbaSha256)
  ) {
    throw new Error('Invalid capture source metadata.')
  }
  // Older captures include original.png. New captures may explicitly omit it or set null.
  if (source.file !== undefined && source.file !== null && source.file !== 'original.png') {
    throw new Error('Capture original filename must be canonical.')
  }
  const originalSaved = source.file === 'original.png'
  if (!Array.isArray(metadata.regions)) throw new Error('Capture regions must be an array.')
  const regions = metadata.regions.map((value) => {
    const input = record(value)
    const id = positiveInteger(input.id, 'ROI ID')
    if (input.file !== roiFilename(id))
      throw new Error('Capture ROI filename does not match its immutable ID.')
    return {
      id,
      x: input.x as number,
      y: input.y as number,
      width: input.width as number,
      height: input.height as number,
      path: join(folder, roiFilename(id))
    }
  })
  validateRegions(regions, { width, height })
  let profile: CaptureSummary['profile']
  if (metadata.profile !== undefined) {
    const input = record(metadata.profile)
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) {
      throw new Error('Invalid profile name.')
    }
    profile = {
      id: positiveInteger(input.id, 'Profile ID'),
      name: input.name
    }
  }
  // Listing checks completion and containment without reading/decompressing full PNGs.
  if (originalSaved) await imageFile(folder, 'original.png')
  for (const region of regions) await imageFile(folder, roiFilename(region.id))
  return {
    folder,
    metadata,
    bytes,
    summary: {
      eventId,
      capturedAt,
      outputDirectory: folder,
      width,
      height,
      trigger,
      originalSaved,
      regions,
      ...(profile ? { profile } : {})
    }
  }
}
