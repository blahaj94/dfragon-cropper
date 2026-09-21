import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import type { CaptureHistory, CaptureSummary } from '../../shared/contracts'
import { roiFilename, validateRegions } from './pixels'

const MAX_METADATA_BYTES = 1024 * 1024
const MAX_PNG_BYTES = 64 * 1024 * 1024
const MAX_DECODED_BYTES = 256 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid capture metadata object.')
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, label: string): number {
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

function eventTimestamp(eventId: unknown): string {
  if (typeof eventId !== 'string' || !/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(eventId)) {
    throw new Error('Invalid capture event ID.')
  }
  const timestamp = `${eventId.slice(0, 4)}-${eventId.slice(4, 6)}-${eventId.slice(6, 8)}T${eventId.slice(9, 11)}:${eventId.slice(11, 13)}:${eventId.slice(13, 15)}`
  const date = new Date(`${timestamp}Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== timestamp) {
    throw new Error('Capture event ID contains an invalid timestamp.')
  }
  return timestamp
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function captureRoot(outputRoot: string): Promise<string> {
  const path = resolve(outputRoot)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Capture root must be a real directory, not a link.')
  return realpath(path)
}

async function eventFolder(root: string, eventId: string): Promise<string> {
  eventTimestamp(eventId)
  const path = join(root, eventId)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Capture event must be a real directory, not a link.')
  const actual = await realpath(path)
  if (actual !== path || dirname(actual) !== root)
    throw new Error('Capture event escapes its output directory.')
  return path
}

async function imageFile(folder: string, filename: string): Promise<string> {
  // Callers only pass fixed metadata.json/original.png or roiFilename(validated integer).
  const path = join(folder, filename)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error('Capture files must be regular files, not links.')
  if ((await realpath(path)) !== path || dirname(path) !== folder)
    throw new Error('Capture file escapes its event directory.')
  return path
}

/** Open a checked regular file and cap reads before allocation, including a file that grows. */
async function readLimited(folder: string, filename: string, limit: number): Promise<Buffer> {
  const path = await imageFile(folder, filename)
  const before = await lstat(path)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      before.isSymbolicLink() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new Error('Capture file changed while opening it.')
    }
    // Recheck containment before reading, including a directory replaced with a link.
    if ((await realpath(path)) !== path || (await lstat(folder)).isSymbolicLink()) {
      throw new Error('Capture file path changed while opening it.')
    }
    if (opened.size <= 0 || opened.size > limit)
      throw new Error(`Capture file exceeds its ${limit} byte limit or is empty.`)
    const bytes = Buffer.allocUnsafe(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error('Capture file was truncated while reading it.')
      offset += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error('Capture file changed while reading it.')
    return bytes
  } finally {
    await handle.close()
  }
}

interface HistoryEvent {
  summary: CaptureSummary
  folder: string
}

async function loadEvent(root: string, eventId: string): Promise<HistoryEvent> {
  const timestamp = eventTimestamp(eventId)
  const folder = await eventFolder(root, eventId)
  const metadata = record(
    JSON.parse((await readLimited(folder, 'metadata.json', MAX_METADATA_BYTES)).toString('utf8'))
  )
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

export async function readCaptureImage(
  outputRoot: string,
  eventId: string,
  regionId: number | null
): Promise<string> {
  eventTimestamp(eventId)
  if (regionId !== null) positiveInteger(regionId, 'ROI ID')
  const event = await loadEvent(await captureRoot(outputRoot), eventId)
  const region =
    regionId === null ? null : event.summary.regions.find((item) => item.id === regionId)
  if (regionId !== null && !region) throw new Error('ROI does not exist in this capture event.')
  if (regionId === null && !event.summary.originalSaved)
    throw new Error('The original image was not saved for this capture.')
  const width = region?.width ?? event.summary.width
  const height = region?.height ?? event.summary.height
  if (width * height * 4 > MAX_DECODED_BYTES)
    throw new Error('Capture image exceeds the 256 MiB decoded preview limit.')
  const png = await readLimited(
    event.folder,
    region ? roiFilename(region.id) : 'original.png',
    MAX_PNG_BYTES
  )
  // Inspect IHDR before pngjs can allocate/decompress an attacker-controlled image size.
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) !== width ||
    png.readUInt32BE(20) !== height ||
    png[24] !== 8 ||
    png[25] !== 6 ||
    png[26] !== 0 ||
    png[27] !== 0 ||
    // The app writes non-interlaced PNGs. pngjs uses an unbounded inflater for Adam7.
    png[28] !== 0
  ) {
    throw new Error('PNG header or dimensions do not match this capture metadata.')
  }
  const decoded = PNG.sync.read(png)
  if (
    decoded.width !== width ||
    decoded.height !== height ||
    decoded.data.length !== width * height * 4
  ) {
    throw new Error('Decoded PNG dimensions do not match this capture metadata.')
  }
  return `data:image/png;base64,${png.toString('base64')}`
}

export async function resolveCaptureFolder(outputRoot: string, eventId?: string): Promise<string> {
  if (eventId !== undefined) eventTimestamp(eventId)
  const root = await captureRoot(outputRoot)
  return eventId === undefined ? root : (await loadEvent(root, eventId)).folder
}
