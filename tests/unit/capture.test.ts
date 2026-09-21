import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bgrxToRgba,
  captureAndSave,
  capturePrimaryFrame,
  cropFrame,
  encodeFramePng,
  roiFilename,
  validateRegions,
  type CaptureRegion,
  type Frame
} from '../../src/main/capture'

// Deliberately non-square, nonuniform, asymmetric pixels expose row/column swaps,
// wrong stride, alpha changes, and off-by-one crops that solid-color fixtures hide.
function sourceFrame(): Frame {
  const width = 7
  const height = 5
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba.set([x * 31 + y, y * 41 + x, x * 13 + y * 17, 255], (y * width + x) * 4)
    }
  }
  return { width, height, rgba, capturedAt: '2026-09-22T05:43:12.321Z', backend: 'fixture' }
}

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function outputRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dfragon-capture-test-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('physical pixel preservation', () => {
  it('extracts the exact requested rows and columns, including the bottom-right edge', () => {
    const frame = sourceFrame()
    const originalBytes = Buffer.from(frame.rgba)
    const region = { id: 2, x: 3, y: 2, width: 4, height: 3 }
    const crop = cropFrame(frame, region)
    expect([crop.width, crop.height, crop.capturedAt]).toEqual([4, 3, frame.capturedAt])
    const expected = []
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 3; x <= 6; x += 1) expected.push(x * 31 + y, y * 41 + x, x * 13 + y * 17, 255)
    }
    expect(crop.rgba).toEqual(Buffer.from(expected))
    expect(frame.rgba).toEqual(originalBytes)
    crop.rgba[0] = 0
    expect(frame.rgba).toEqual(originalBytes) // Crop storage does not alias the source.
  })

  it('preserves source and crop bytes through lossless PNG encoding', () => {
    const source = sourceFrame()
    const crop = cropFrame(source, { id: 1, x: 1, y: 1, width: 3, height: 2 })
    for (const frame of [source, crop]) {
      const decoded = PNG.sync.read(encodeFramePng(frame))
      expect([decoded.width, decoded.height]).toEqual([frame.width, frame.height])
      expect(decoded.data).toEqual(frame.rgba)
    }
  })

  it('only reorders BGRX channel storage and replaces unused X with opaque alpha', () => {
    const bgrx = Buffer.from([13, 17, 19, 0, 29, 31, 37, 42])
    expect(bgrxToRgba(bgrx)).toEqual(Buffer.from([19, 17, 13, 255, 37, 31, 29, 255]))
    expect(bgrx).toEqual(Buffer.from([13, 17, 19, 0, 29, 31, 37, 42]))
  })

  it.each([
    { x: -1 },
    { y: -1 },
    { x: 0.5 },
    { y: NaN },
    { width: 0 },
    { height: -2 },
    { width: Infinity },
    { width: 8 },
    { y: 4, height: 2 },
    { id: 0 }
  ])('rejects invalid ROI without clipping or rescaling: %j', (invalid) => {
    const region: CaptureRegion = { id: 1, x: 0, y: 0, width: 1, height: 1, ...invalid }
    expect(() => cropFrame(sourceFrame(), region)).toThrow()
  })

  it('rejects duplicate immutable ROI IDs', () => {
    const region = { id: 7, x: 0, y: 0, width: 1, height: 1 }
    expect(() => validateRegions([region, { ...region, x: 1 }])).toThrow(/unique/)
  })
})

describe('one event, one source frame', () => {
  it('writes original and all regions from one source invocation with stable filenames and metadata', async () => {
    const frame = sourceFrame()
    const captureFrame = vi.fn(() => frame)
    const regions = [
      { id: 1, x: 1, y: 1, width: 2, height: 3 },
      { id: 17, x: 4, y: 0, width: 3, height: 2 }
    ]
    const result = await captureAndSave({
      outputRoot: await outputRoot(),
      regions,
      trigger: 'fixture',
      captureFrame
    })
    expect(captureFrame).toHaveBeenCalledTimes(1)
    expect(result.eventId).toMatch(/^20260922-054312-[a-f0-9]{8}$/)
    expect(result.sourceSha256).toBe(createHash('sha256').update(frame.rgba).digest('hex'))
    expect((await readdir(result.outputDirectory)).sort()).toEqual([
      '001.png',
      '017.png',
      'metadata.json',
      'original.png'
    ])
    expect(PNG.sync.read(await readFile(result.originalPath)).data).toEqual(frame.rgba)
    for (const region of result.regions) {
      const decoded = PNG.sync.read(await readFile(region.path))
      expect([decoded.width, decoded.height]).toEqual([region.width, region.height])
      // Compare each saved pixel against the independently indexed original, not another crop.
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          const expectedOffset = ((y + region.y) * frame.width + x + region.x) * 4
          const actualOffset = (y * region.width + x) * 4
          expect(decoded.data.subarray(actualOffset, actualOffset + 4)).toEqual(
            frame.rgba.subarray(expectedOffset, expectedOffset + 4)
          )
        }
      }
    }
    const metadata = JSON.parse(
      await readFile(join(result.outputDirectory, 'metadata.json'), 'utf8')
    )
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      eventId: result.eventId,
      capturedAt: frame.capturedAt,
      trigger: 'fixture',
      coordinateSpace: 'primary-monitor-physical-pixels',
      source: {
        width: 7,
        height: 5,
        pixelFormat: 'rgba8',
        backend: 'fixture',
        rgbaSha256: result.sourceSha256,
        file: 'original.png'
      },
      regions: regions.map((region) => ({ ...region, file: roiFilename(region.id) }))
    })
  })

  it('rejects malformed ROI before capture and out-of-bounds ROI before creating an event', async () => {
    const root = await outputRoot()
    const captureFrame = vi.fn(sourceFrame)
    await expect(
      captureAndSave({
        outputRoot: root,
        regions: [{ id: 1, x: -1, y: 0, width: 1, height: 1 }],
        trigger: 'fixture',
        captureFrame
      })
    ).rejects.toThrow(/coordinates/)
    expect(captureFrame).not.toHaveBeenCalled()
    await expect(
      captureAndSave({
        outputRoot: root,
        regions: [{ id: 1, x: 7, y: 0, width: 1, height: 1 }],
        trigger: 'fixture',
        captureFrame
      })
    ).rejects.toThrow(/outside/)
    expect(captureFrame).toHaveBeenCalledTimes(1)
    expect(await readdir(root)).toEqual([])
  })

  it('allocates different directories for captures with the same timestamp', async () => {
    const options = {
      outputRoot: await outputRoot(),
      regions: [],
      trigger: 'fixture' as const,
      captureFrame: sourceFrame
    }
    const first = await captureAndSave(options)
    const second = await captureAndSave(options)
    expect(first.eventId).not.toBe(second.eventId)
    expect(await readdir(options.outputRoot)).toHaveLength(2)
  })

  it.runIf(process.platform !== 'win32')(
    'fails explicitly on non-Windows without accessing a native display',
    () => {
      expect(() => capturePrimaryFrame()).toThrow('Desktop capture requires Windows 10.')
    }
  )
})
