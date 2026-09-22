import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAndSave, type CaptureResult } from '../../src/main/capture'
import { listCaptures } from '../../src/main/capture/history'
import { createGroundTruthLibrary } from '../../src/main/ground-truth'
import type { GroundTruthCapture } from '../../src/shared/contracts'

const failPublication = vi.hoisted(() => ({ directory: '' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    rename: async (...args: Parameters<typeof original.rename>) => {
      if (
        failPublication.directory &&
        String(args[1]) === join(failPublication.directory, 'metadata.json')
      )
        throw new Error('Synthetic metadata publication failure')
      return original.rename(...args)
    }
  }
})

const directories: string[] = []
afterEach(async () => {
  failPublication.directory = ''
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dfragon-ground-truth-'))
  directories.push(path)
  return realpath(path)
}

async function capture(
  outputRoot: string,
  capturedAt = '2026-09-22T08:00:00.000Z'
): Promise<CaptureResult> {
  return captureAndSave({
    outputRoot,
    regions: [
      { id: 1, x: 0, y: 0, width: 3, height: 2 },
      { id: 9, x: 3, y: 2, width: 3, height: 2 }
    ],
    profile: { id: 3, name: 'Captured profile' },
    trigger: 'fixture',
    captureFrame: () => ({
      width: 6,
      height: 4,
      rgba: Buffer.alloc(6 * 4 * 4, 41),
      capturedAt,
      backend: 'fixture'
    })
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

function command(event: GroundTruthCapture, regionId = 1, text: string | null = '용용이') {
  return { captureKey: event.key, revision: event.revision, regionId, text }
}

describe('image ground truth metadata', () => {
  it('reads legacy captures as unanswered, saves independent nicknames, and reloads after restart', async () => {
    const output = await root()
    const result = await capture(output)
    await editMetadata(result, (metadata) => {
      delete metadata.profile
    })
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    expect(event.profile).toBeUndefined()
    expect(event.regions.map((region) => region.text)).toEqual([null, null])
    expect(event.regions[0]).not.toHaveProperty('path')
    await library.save(command(event, 1, '  캐릭터 닉네임  '))
    const firstSave = await library.read(event.key)
    expect(firstSave.regions.map((region) => region.text)).toEqual(['  캐릭터 닉네임  ', null])
    await library.save(command(firstSave, 9, '둘째'))
    const restarted = createGroundTruthLibrary([output])
    const [reloaded] = (await restarted.list()).events
    expect(reloaded.regions.map((region) => region.text)).toEqual(['  캐릭터 닉네임  ', '둘째'])
    const cleared = await restarted.save(command(reloaded, 1, ' \t '))
    expect(cleared.text).toBeNull()
    const clearedAgain = await restarted.save({ ...cleared, text: null })
    expect(clearedAgain.text).toBeNull()
    const metadata = JSON.parse(
      await readFile(join(result.outputDirectory, 'metadata.json'), 'utf8')
    )
    expect(metadata.groundTruth).toEqual({ schemaVersion: 1, regions: { '1': null, '9': '둘째' } })
    expect(metadata.schemaVersion).toBe(1)
  })

  it('patches only the chosen answer, preserving unknown fields, exact prior bytes and every PNG', async () => {
    const output = await root()
    const result = await capture(output)
    await editMetadata(result, (metadata) => {
      metadata.futureCaptureData = { values: [1, 'untouched', null] }
      metadata.groundTruth = {
        schemaVersion: 1,
        futureAnnotationData: 'retained',
        regions: { '9': '기존' }
      }
    })
    const path = join(result.outputDirectory, 'metadata.json')
    const previous = await readFile(path)
    const pngs = await Promise.all(
      [result.originalPath!, ...result.regions.map((region) => region.path)].map(
        async (path) => [path, await readFile(path)] as const
      )
    )
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    const expected = JSON.parse(previous.toString('utf8'))
    expected.groundTruth.regions['1'] = '정답'
    await library.save(command(event, 1, '정답'))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected)
    expect(await readFile(`${path}.bak`)).toEqual(previous)
    for (const [path, bytes] of pngs) expect(await readFile(path)).toEqual(bytes)
    expect(await library.readImage(event.key, 9)).toBe(
      `data:image/png;base64,${pngs[2][1].toString('base64')}`
    )
    expect((await listCaptures(output)).events[0].eventId).toBe(event.eventId)
  })

  it('serializes concurrent row saves, rejects stale snapshots, and permits a reloaded retry', async () => {
    const output = await root()
    await capture(output)
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    const saves = await Promise.allSettled([
      library.save(command(event, 1, '하나')),
      library.save(command(event, 9, '아홉'))
    ])
    expect(saves.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((saves[1] as PromiseRejectedResult).reason.message).toMatch(/metadata changed/)
    const reloaded = await library.read(event.key)
    expect(reloaded.regions.map((region) => region.text)).toEqual(['하나', null])
    await library.save(command(reloaded, 9, '아홉'))
    expect((await library.read(event.key)).regions.map((region) => region.text)).toEqual([
      '하나',
      '아홉'
    ])
  })

  it('detects external metadata changes without publishing a backup or overwriting them', async () => {
    const output = await root()
    const result = await capture(output)
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    await editMetadata(result, (metadata) => {
      metadata.note = 'external edit'
    })
    const path = join(result.outputDirectory, 'metadata.json')
    const externalBytes = await readFile(path)
    await expect(library.save(command(event))).rejects.toThrow(/metadata changed/)
    expect(await readFile(path)).toEqual(externalBytes)
    await expect(readFile(`${path}.bak`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not poison a valid queued row save when its preceding command fails', async () => {
    const output = await root()
    await capture(output)
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    const saves = await Promise.allSettled([
      library.save(command(event, 99, 'unknown ROI')),
      library.save(command(event, 9, 'valid queued nickname'))
    ])
    expect(saves.map((result) => result.status)).toEqual(['rejected', 'fulfilled'])
    expect((await library.read(event.key)).regions[1].text).toBe('valid queued nickname')
  })

  it('preserves the current file and a valid backup after a failed atomic publication, then recovers', async () => {
    const output = await root()
    const result = await capture(output)
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    const path = join(result.outputDirectory, 'metadata.json')
    const previous = await readFile(path)
    failPublication.directory = result.outputDirectory
    await expect(library.save(command(event))).rejects.toThrow(
      /Synthetic metadata publication failure/
    )
    expect(await readFile(path)).toEqual(previous)
    expect(await readFile(`${path}.bak`)).toEqual(previous)
    expect((await readdir(result.outputDirectory)).some((name) => name.endsWith('.tmp'))).toBe(
      false
    )
    expect((await library.read(event.key)).regions[0].text).toBeNull()
    failPublication.directory = ''
    await library.save(command(event))
    expect((await library.read(event.key)).regions[0].text).toBe('용용이')
  })

  it.each([
    { schemaVersion: 2, regions: {} },
    { schemaVersion: 1, regions: { '99': 'unknown region' } },
    { schemaVersion: 1, regions: { '1': true } }
  ])(
    'makes invalid annotations read-only without hiding capture images: %j',
    async (groundTruth) => {
      const output = await root()
      const result = await capture(output)
      await editMetadata(result, (metadata) => {
        metadata.groundTruth = groundTruth
      })
      const path = join(result.outputDirectory, 'metadata.json')
      const previous = await readFile(path)
      const library = createGroundTruthLibrary([output])
      const [event] = (await library.list()).events
      expect(event.annotationError).toBeTruthy()
      expect((await listCaptures(output)).events).toHaveLength(1)
      expect(await library.readImage(event.key, 1)).toMatch(/^data:image\/png;base64,/)
      await expect(library.save(command(event))).rejects.toThrow()
      expect(await readFile(path)).toEqual(previous)
    }
  )

  it('rejects untrusted commands, unknown IDs, originals and oversized metadata without writes', async () => {
    const output = await root()
    const result = await capture(output)
    const library = createGroundTruthLibrary([output])
    const [event] = (await library.list()).events
    for (const input of [
      null,
      {},
      { ...command(event), extra: true },
      { ...command(event), text: 9 },
      { ...command(event), text: 'x'.repeat(501) },
      { ...command(event), regionId: null },
      { ...command(event), regionId: '1' },
      { ...command(event), regionId: 99 },
      { ...command(event), captureKey: '../outside' },
      { ...command(event), revision: '' }
    ])
      await expect(library.save(input)).rejects.toThrow()
    await expect(library.readImage(event.key, null)).rejects.toThrow(/positive safe integer/)
    await expect(library.read('0'.repeat(64))).rejects.toThrow(/no longer available/)
    await expect(library.list('../cursor')).rejects.toThrow(/cursor/)
    await expect(library.list('0'.repeat(64))).rejects.toThrow(/cursor expired/)
    await editMetadata(result, (metadata) => {
      metadata.padding = ''
      metadata.padding = 'x'.repeat(1024 * 1024 - Buffer.byteLength(JSON.stringify(metadata)) - 10)
    })
    const reloaded = await library.read(event.key)
    const before = await readFile(join(result.outputDirectory, 'metadata.json'))
    await expect(library.save(command(reloaded, 1, 'x'.repeat(500)))).rejects.toThrow(/1 MiB/)
    expect(await readFile(join(result.outputDirectory, 'metadata.json'))).toEqual(before)
  })
})

describe('ground truth archive identity and pagination', () => {
  it('pages the entire archive oldest-first, including exact milliseconds at a page boundary', async () => {
    const output = await root()
    const captures: CaptureResult[] = []
    for (let i = 0; i < 105; i++) {
      // The first 23 share a second, ensuring random ID suffixes cannot drop boundary rows.
      const date = new Date(Date.UTC(2026, 8, 22, 8, 0, i < 23 ? 0 : i - 22, i < 23 ? i * 30 : 0))
      captures.push(await capture(output, date.toISOString()))
    }
    const library = createGroundTruthLibrary([output])
    const events: GroundTruthCapture[] = []
    let cursor: string | null = null
    do {
      const page = await library.list(cursor)
      expect(page.events.length).toBeLessThanOrEqual(20)
      events.push(...page.events)
      cursor = page.nextCursor
    } while (cursor)
    expect(events.map((event) => event.eventId)).toEqual(captures.map((event) => event.eventId))
    expect(new Set(events.map((event) => event.key)).size).toBe(105)
    expect((await listCaptures(output)).events).toHaveLength(100)
  })

  it('uses current-root priority and pins all later reads and edits to that exact physical copy', async () => {
    const current = await root()
    const legacy = await root()
    const legacyEvent = await capture(legacy)
    const currentFolder = join(current, legacyEvent.eventId)
    await cp(legacyEvent.outputDirectory, currentFolder, { recursive: true })
    const copied = { ...legacyEvent, outputDirectory: currentFolder }
    await editMetadata(copied, (metadata) => {
      metadata.profile = { id: 3, name: 'Current' }
    })
    const library = createGroundTruthLibrary([current, legacy])
    const [event] = (await library.list()).events
    expect(event.profile?.name).toBe('Current')
    const legacyBefore = await readFile(join(legacyEvent.outputDirectory, 'metadata.json'))
    await library.save(command(event))
    expect(await readFile(join(legacyEvent.outputDirectory, 'metadata.json'))).toEqual(legacyBefore)
    const loaded = await library.read(event.key)
    await rm(join(currentFolder, '001.png'))
    await expect(library.readImage(event.key, 1)).rejects.toThrow()
    await expect(library.save(command(loaded, 9, 'must not fall back'))).rejects.toThrow()
    expect(await readFile(join(legacyEvent.outputDirectory, 'metadata.json'))).toEqual(legacyBefore)
    expect((await library.list()).events).toHaveLength(0)
    await rm(currentFolder, { recursive: true })
    await cp(legacyEvent.outputDirectory, currentFolder, { recursive: true })
    await expect(library.read(event.key)).rejects.toThrow(/directory changed/)
  })

  it('allows absent roots and skips incomplete events while keeping completed legacy data', async () => {
    const output = await root()
    const result = await capture(output)
    await mkdir(join(output, '20260922-080001-ffffffff'))
    const library = createGroundTruthLibrary([join(output, 'not-created'), output])
    const page = await library.list()
    expect(page.events.map((event) => event.eventId)).toEqual([result.eventId])
    expect(page.skippedEntries).toBe(1)
    expect(page.nextCursor).toBeNull()
  })

  it.runIf(process.platform !== 'win32')(
    'rejects linked metadata, backups, event folders and replaced roots',
    async () => {
      const output = await root()
      const external = await root()
      const result = await capture(output)
      const outside = await capture(external)
      const library = createGroundTruthLibrary([output])
      const [event] = (await library.list()).events
      const path = join(result.outputDirectory, 'metadata.json')
      const bytes = await readFile(path)
      await symlink(join(outside.outputDirectory, 'metadata.json'), `${path}.bak`)
      await expect(library.save(command(event))).rejects.toThrow(/not links/)
      expect(await readFile(path)).toEqual(bytes)
      await rm(`${path}.bak`)
      await rm(path)
      await symlink(join(outside.outputDirectory, 'metadata.json'), path)
      await expect(library.save(command(event))).rejects.toThrow(/not links/)
      await rm(result.outputDirectory, { recursive: true })
      await symlink(outside.outputDirectory, result.outputDirectory)
      await expect(library.readImage(event.key, 1)).rejects.toThrow(/not a link/)
      await rm(result.outputDirectory)
      await cp(outside.outputDirectory, result.outputDirectory, { recursive: true })
      const moved = join(external, basename(output))
      await rename(output, moved)
      await symlink(moved, output)
      await expect(library.read(event.key)).rejects.toThrow(/not a link/)
    }
  )
})
