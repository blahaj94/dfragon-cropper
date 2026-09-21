import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'
import { captureAndSave, type CaptureResult, type Frame } from '../../src/main/capture'
import {
  listCaptures,
  readCaptureImage,
  resolveCaptureFolder
} from '../../src/main/capture/history'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function outputRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dfragon-history-'))
  directories.push(directory)
  return realpath(directory)
}

function frame(capturedAt = '2026-09-22T08:00:00.000Z'): Frame {
  const rgba = Buffer.alloc(6 * 4 * 4)
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 11) % 256
  return { width: 6, height: 4, rgba, capturedAt, backend: 'fixture' }
}

async function capture(
  root: string,
  capturedAt?: string,
  saveOriginal = true
): Promise<CaptureResult> {
  return captureAndSave({
    outputRoot: root,
    regions: [{ id: 7, x: 1, y: 1, width: 3, height: 2 }],
    profile: { id: 3, name: 'Saved profile' },
    trigger: 'fixture',
    saveOriginal,
    captureFrame: () => frame(capturedAt)
  })
}

async function editMetadata(
  result: CaptureResult,
  edit: (metadata: Record<string, unknown>) => void
): Promise<void> {
  const path = join(result.outputDirectory, 'metadata.json')
  const metadata = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  edit(metadata)
  await writeFile(path, JSON.stringify(metadata))
}

describe('capture history and previews', () => {
  it('loads saved snapshots in timestamp order, including older metadata without a profile or source file', async () => {
    const root = await outputRoot()
    const older = await capture(root, '2026-09-22T08:00:00.050Z')
    const newer = await capture(root, '2026-09-22T08:00:00.900Z', false)
    await editMetadata(older, (metadata) => {
      delete metadata.profile
    })
    await editMetadata(newer, (metadata) => {
      delete (metadata.source as Record<string, unknown>).file
    })
    const history = await listCaptures(root)
    expect(history.events.map((event) => event.eventId)).toEqual([newer.eventId, older.eventId])
    expect(history.events[0]).toMatchObject({
      originalSaved: false,
      profile: { id: 3, name: 'Saved profile' },
      width: 6,
      height: 4
    })
    expect(history.events[1]).toMatchObject({ originalSaved: true })
    expect(history.events[1].profile).toBeUndefined()
    expect(history).toMatchObject({ skippedEntries: 0, hasMore: false })
    expect(await resolveCaptureFolder(root)).toBe(root)
    expect(await resolveCaptureFolder(root, newer.eventId)).toBe(newer.outputDirectory)
    await expect(readCaptureImage(root, newer.eventId, null)).rejects.toThrow(/not saved/)
  })

  it('returns exact stored PNG data URLs for the original and numeric ROI ID', async () => {
    const root = await outputRoot()
    const result = await capture(root)
    const original = await readCaptureImage(root, result.eventId, null)
    expect(original).toBe(
      `data:image/png;base64,${(await readFile(result.originalPath!)).toString('base64')}`
    )
    const image = await readCaptureImage(root, result.eventId, 7)
    const decoded = PNG.sync.read(Buffer.from(image.split(',')[1], 'base64'))
    expect([decoded.width, decoded.height]).toEqual([3, 2])
    await expect(readCaptureImage(root, result.eventId, 1)).rejects.toThrow(/does not exist/)
    await expect(readCaptureImage(root, result.eventId, '7' as unknown as number)).rejects.toThrow(
      /safe integer/
    )
  })

  it('finishes the boundary second for exact ordering, without inspecting older archive entries', async () => {
    const root = await outputRoot()
    for (let i = 1; i <= 99; i++) {
      await capture(root, new Date(Date.UTC(2026, 8, 22, 8, 0, i)).toISOString(), false)
    }
    // In descending filename order, the newest millisecond entry comes after
    // the 101st valid entry. It must still win the final visible slot.
    for (const [milliseconds, suffix] of [
      ['100', 'ffffffff'],
      ['300', 'eeeeeeee'],
      ['900', '11111111'],
      ['800', '00000000']
    ]) {
      const result = await capture(root, `2026-09-22T08:00:00.${milliseconds}Z`, false)
      const eventId = `20260922-080000-${suffix}`
      const outputDirectory = join(root, eventId)
      await rename(result.outputDirectory, outputDirectory)
      await editMetadata({ ...result, eventId, outputDirectory }, (metadata) => {
        metadata.eventId = eventId
      })
    }
    const uninspected = join(root, '20260921-000000-deadbeef')
    await mkdir(uninspected)
    await writeFile(join(uninspected, 'metadata.json'), '{old broken entry, never inspected')
    const history = await listCaptures(root)
    expect(history.events).toHaveLength(100)
    expect(history.events[0].capturedAt).toBe('2026-09-22T08:01:39.000Z')
    expect(history.events[99].capturedAt).toBe('2026-09-22T08:00:00.900Z')
    expect(history).toMatchObject({ skippedEntries: 0, hasMore: true })
  })

  it('returns an empty list for a missing capture root and skips incomplete or damaged entries', async () => {
    const root = await outputRoot()
    expect(await listCaptures(join(root, 'not-created'))).toEqual({
      events: [],
      skippedEntries: 0,
      hasMore: false
    })
    const valid = await capture(root)
    await mkdir(join(root, '20260922-080010-12345678'))
    await mkdir(join(root, '20260922-080011-12345678'))
    await writeFile(join(root, '20260922-080011-12345678', 'metadata.json'), '{broken')
    const missingPng = await capture(root, '2026-09-22T08:00:12.000Z')
    await rm(missingPng.regions[0].path)
    const history = await listCaptures(root)
    expect(history.events.map((event) => event.eventId)).toEqual([valid.eventId])
    expect(history.skippedEntries).toBe(3)
  })
})

describe('history file boundaries', () => {
  it.each([
    '../secrets',
    '20260922-080000-12345678/../outside',
    'C:\\secret',
    '20260230-080000-12345678',
    '20260922-250000-12345678'
  ])('rejects noncanonical event ID %s before opening a file', async (eventId) => {
    const root = await outputRoot()
    await expect(readCaptureImage(root, eventId, null)).rejects.toThrow(/event ID/)
    await expect(resolveCaptureFolder(root, eventId)).rejects.toThrow(/event ID/)
  })

  it.each([
    (metadata: Record<string, unknown>) => {
      metadata.eventId = '20260922-080000-ffffffff'
    },
    (metadata: Record<string, unknown>) => {
      metadata.capturedAt = '2026-09-23T08:00:00.000Z'
    },
    (metadata: Record<string, unknown>) => {
      metadata.schemaVersion = 99
    },
    (metadata: Record<string, unknown>) => {
      ;(metadata.source as Record<string, unknown>).file = '../secret.png'
    },
    (metadata: Record<string, unknown>) => {
      ;(metadata.source as Record<string, unknown>).width = Infinity
    },
    (metadata: Record<string, unknown>) => {
      ;(metadata.regions as Record<string, unknown>[])[0].file = '008.png'
    },
    (metadata: Record<string, unknown>) => {
      ;(metadata.regions as Record<string, unknown>[])[0].x = -1
    },
    (metadata: Record<string, unknown>) => {
      ;(metadata.regions as Record<string, unknown>[])[0].width = 999
    },
    (metadata: Record<string, unknown>) => {
      const regions = metadata.regions as Record<string, unknown>[]
      regions.push({ ...regions[0] })
    }
  ])('skips metadata that breaks identity, filenames or pixel bounds', async (edit) => {
    const root = await outputRoot()
    const result = await capture(root)
    await editMetadata(result, edit)
    expect(await listCaptures(root)).toEqual({ events: [], skippedEntries: 1, hasMore: false })
    await expect(readCaptureImage(root, result.eventId, 7)).rejects.toThrow()
  })

  it.runIf(process.platform !== 'win32')(
    'rejects symlinked roots, event folders, metadata, and PNGs',
    async () => {
      const root = await outputRoot()
      const outside = await outputRoot()
      const external = await capture(outside)
      const rootLink = join(root, 'root-link')
      await symlink(outside, rootLink, 'dir')
      await expect(listCaptures(rootLink)).rejects.toThrow(/not a link/)
      await rm(rootLink)
      await symlink(external.outputDirectory, join(root, external.eventId), 'dir')
      expect((await listCaptures(root)).skippedEntries).toBe(1)
      await expect(resolveCaptureFolder(root, external.eventId)).rejects.toThrow(/not a link/)
      await rm(join(root, external.eventId))
      const local = await capture(root)
      const metadataPath = join(local.outputDirectory, 'metadata.json')
      const originalMetadata = await readFile(metadataPath)
      await rm(metadataPath)
      await symlink(join(external.outputDirectory, 'metadata.json'), metadataPath, 'file')
      await expect(readCaptureImage(root, local.eventId, 7)).rejects.toThrow(/not links/)
      await rm(metadataPath)
      await writeFile(metadataPath, originalMetadata)
      await rm(local.regions[0].path)
      await symlink(external.regions[0].path, local.regions[0].path, 'file')
      await expect(readCaptureImage(root, local.eventId, 7)).rejects.toThrow(/not links/)
      expect((await listCaptures(root)).skippedEntries).toBe(1)
    }
  )

  it('checks image signatures, dimensions and CRCs only when the image is requested', async () => {
    const root = await outputRoot()
    const result = await capture(root)
    const original = await readFile(result.regions[0].path)
    const wrongSize = Buffer.from(original)
    wrongSize.writeUInt32BE(40000, 16)
    await writeFile(result.regions[0].path, wrongSize)
    expect((await listCaptures(root)).events).toHaveLength(1) // Listing does not decode PNGs.
    await expect(readCaptureImage(root, result.eventId, 7)).rejects.toThrow(/header or dimensions/)
    // These must fail at our header gate, before pngjs reaches its inflater/CRC parser.
    for (const index of [26, 27, 28]) {
      const unsupportedEncoding = Buffer.from(original)
      unsupportedEncoding[index] = 1
      await writeFile(result.regions[0].path, unsupportedEncoding)
      await expect(readCaptureImage(root, result.eventId, 7)).rejects.toThrow(
        /header or dimensions/
      )
    }
    const corrupt = Buffer.from(original)
    corrupt[29] ^= 1 // Corrupt IHDR CRC, leaving dimensions unchanged.
    await writeFile(result.regions[0].path, corrupt)
    await expect(readCaptureImage(root, result.eventId, 7)).rejects.toThrow()
    await writeFile(result.regions[0].path, 'not PNG')
    await expect(readCaptureImage(root, result.eventId, 7)).rejects.toThrow(/header or dimensions/)
  })

  it('refuses oversized image and metadata files before reading their contents', async () => {
    const root = await outputRoot()
    const result = await capture(root)
    await truncate(result.regions[0].path, 64 * 1024 * 1024 + 1)
    await expect(readCaptureImage(root, result.eventId, 7)).rejects.toThrow(/byte limit/)
    await truncate(join(result.outputDirectory, 'metadata.json'), 1024 * 1024 + 1)
    expect(await listCaptures(root)).toEqual({ events: [], skippedEntries: 1, hasMore: false })
  })
})
