import { createHash, randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  cropFrame,
  encodeFramePng,
  roiFilename,
  validateFrame,
  validateRegions,
  type CaptureRegion,
  type PixelFrame
} from './pixels'
import { capturePrimaryFrame } from './win32'

export { capturePrimaryFrame } from './win32'
export {
  bgrxToRgba,
  cropFrame,
  encodeFramePng,
  roiFilename,
  validateFrame,
  validateRegions
} from './pixels'
export type { CaptureRegion, PixelFrame } from './pixels'
export type { PixelFrame as Frame } from './pixels'

export type CaptureTrigger = 'button' | 'printscreen' | 'fixture' | 'native-pixel-check'

export interface CaptureResult {
  eventId: string
  capturedAt: string
  outputDirectory: string
  width: number
  height: number
  trigger: CaptureTrigger
  sourceSha256: string
  originalPath: string
  regions: (CaptureRegion & { path: string })[]
  profile?: { id: number; name: string }
}

export interface CaptureOptions {
  outputRoot: string
  regions: readonly CaptureRegion[]
  trigger: CaptureTrigger
  profile?: { id: number; name: string }
  /** Main-only dependency injection for deterministic verification; never supplied by IPC. */
  captureFrame?: () => PixelFrame
}

export async function captureAndSave(options: CaptureOptions): Promise<CaptureResult> {
  const regions = options.regions.map((region) => ({ ...region }))
  const profile = options.profile ? { ...options.profile } : undefined
  validateRegions(regions)
  if (!options.outputRoot.trim()) throw new Error('A capture output directory is required.')

  // This is the only call to the native source. All PNGs below use this same frame.
  const frame = (options.captureFrame ?? capturePrimaryFrame)()
  validateFrame(frame)
  validateRegions(regions, frame)
  const compactTimestamp = new Date(frame.capturedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  const eventId = `${compactTimestamp}-${randomBytes(4).toString('hex')}`
  const outputRoot = resolve(options.outputRoot)
  const outputDirectory = join(outputRoot, eventId)
  const originalPath = join(outputDirectory, 'original.png')
  const sourceSha256 = createHash('sha256').update(frame.rgba).digest('hex')
  const result: CaptureResult = {
    eventId,
    capturedAt: frame.capturedAt,
    outputDirectory,
    width: frame.width,
    height: frame.height,
    trigger: options.trigger,
    ...(profile ? { profile } : {}),
    sourceSha256,
    originalPath,
    regions: regions.map((region) => ({
      ...region,
      path: join(outputDirectory, roiFilename(region.id))
    }))
  }

  await mkdir(outputRoot, { recursive: true })
  // Exclusive directory creation: a collision must fail, never overwrite an earlier event.
  await mkdir(outputDirectory)
  try {
    await writeFile(originalPath, encodeFramePng(frame), { flag: 'wx' })
    for (const region of result.regions) {
      await writeFile(region.path, encodeFramePng(cropFrame(frame, region)), { flag: 'wx' })
    }
    // metadata.json is written last, so a completed event has all referenced PNGs.
    await writeFile(
      join(outputDirectory, 'metadata.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          eventId,
          capturedAt: frame.capturedAt,
          trigger: options.trigger,
          ...(profile ? { profile } : {}),
          coordinateSpace: 'primary-monitor-physical-pixels',
          source: {
            width: frame.width,
            height: frame.height,
            pixelFormat: 'rgba8',
            backend: frame.backend,
            deviceName: frame.deviceName,
            rgbaSha256: sourceSha256,
            file: 'original.png'
          },
          regions: regions.map((region) => ({ ...region, file: roiFilename(region.id) }))
        },
        null,
        2
      )}\n`,
      { flag: 'wx' }
    )
    return result
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true })
    throw error
  }
}
