import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadProfileStore, ProfileFileConflictError } from '../../src/main/profiles'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function configPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dfragon-profiles-'))
  directories.push(directory)
  return join(directory, 'config.json')
}

const rectangle = { x: 3, y: 7, width: 11, height: 13 }

describe('persistent profile editing', () => {
  it('creates the default config once and returns detached snapshots', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    expect(store.get()).toEqual({
      schemaVersion: 1,
      nextProfileId: 2,
      activeProfileId: 1,
      profiles: [
        {
          id: 1,
          name: 'Default',
          nextRegionId: 3,
          regions: [
            { id: 1, x: 16, y: 24, width: 128, height: 96 },
            { id: 2, x: 96, y: 48, width: 80, height: 64 }
          ]
        }
      ]
    })
    const snapshot = store.get()
    snapshot.profiles[0].regions[0].x = 999
    expect(store.get().profiles[0].regions[0].x).toBe(16)
    expect((await loadProfileStore(path)).get()).toEqual(store.get())
    expect(await readdir(dirname(path))).toEqual(['config.json'])
  })

  it('persists profile and ROI edits, keeping IDs immutable and never recycling deleted IDs', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    await store.apply({ type: 'delete-region', profileId: 1, regionId: 2 })
    await store.apply({ type: 'add-region', profileId: 1, rectangle })
    await store.apply({
      type: 'update-region',
      profileId: 1,
      regionId: 3,
      rectangle: { ...rectangle, x: 19 }
    })
    await store.apply({ type: 'rename-profile', profileId: 1, name: '  Game  ' })
    const created = await store.apply({ type: 'create-profile', name: 'Second' })
    expect(created.profiles[1]).toEqual({ id: 2, name: 'Second', nextRegionId: 1, regions: [] })
    expect(created.activeProfileId).toBe(2)
    await store.apply({ type: 'delete-profile', profileId: 2 })
    expect(store.get().activeProfileId).toBe(1)
    await store.apply({ type: 'create-profile', name: 'Third' })
    await store.apply({ type: 'activate-profile', profileId: 1 })
    const actual = (await loadProfileStore(path)).get()
    expect(actual.nextProfileId).toBe(4)
    expect(actual.activeProfileId).toBe(1)
    expect(actual.profiles.map((profile) => profile.id)).toEqual([1, 3])
    expect(actual.profiles[0]).toMatchObject({ name: 'Game', nextRegionId: 4 })
    expect(actual.profiles[0].regions.map((region) => region.id)).toEqual([1, 3])
    expect(actual.profiles[0].regions[1]).toEqual({ id: 3, ...rectangle, x: 19 })
    created.profiles[0].name = 'External mutation'
    expect(store.get().profiles[0].name).toBe('Game')
  })

  it('selects the next profile after active deletion and permits empty configurations', async () => {
    const store = await loadProfileStore(await configPath())
    await store.apply({ type: 'create-profile', name: 'Second' })
    await store.apply({ type: 'create-profile', name: 'Third' })
    await store.apply({ type: 'activate-profile', profileId: 2 })
    await store.apply({ type: 'delete-profile', profileId: 2 })
    expect(store.get().activeProfileId).toBe(3)
    await store.apply({ type: 'delete-profile', profileId: 1 })
    expect(store.get().activeProfileId).toBe(3)
    await store.apply({ type: 'delete-profile', profileId: 3 })
    expect(store.get()).toMatchObject({ activeProfileId: null, nextProfileId: 4, profiles: [] })
    const settings = await store.apply({ type: 'create-profile', name: 'Restart' })
    expect(settings.profiles[0].id).toBe(4)
    expect(settings.activeProfileId).toBe(4)
  })

  it('backs up the exact previous valid file and leaves no temporary files after edits', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const previous = await readFile(path, 'utf8')
    await store.apply({ type: 'rename-profile', profileId: 1, name: 'Changed' })
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(previous)
    const second = await readFile(path, 'utf8')
    await store.apply({ type: 'add-region', profileId: 1, rectangle })
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(second)
    expect((await readdir(dirname(path))).sort()).toEqual(['config.json', 'config.json.bak'])
  })

  it('serializes simultaneous commands and snapshots caller-owned inputs when queued', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const input = { type: 'add-region', profileId: 1, rectangle: { ...rectangle } }
    const operations = [
      store.apply({ type: 'create-profile', name: 'Second' }),
      store.apply(input),
      store.apply({ type: 'create-profile', name: 'Third' }),
      store.apply({ type: 'add-region', profileId: 1, rectangle })
    ]
    input.rectangle.x = 999
    await Promise.all(operations)
    expect(store.get().profiles.map((profile) => profile.id)).toEqual([1, 2, 3])
    expect(store.get().profiles[0].regions.slice(2)).toEqual([
      { id: 3, ...rectangle },
      { id: 4, ...rectangle }
    ])
    expect((await loadProfileStore(path)).get()).toEqual(store.get())
  })

  it('does not commit memory or consume IDs after a filesystem failure, and the queue recovers', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const before = store.get()
    const original = await readFile(path, 'utf8')
    // A directory cannot be atomically replaced with the regular backup file, on Windows or POSIX.
    await mkdir(`${path}.bak`)
    await expect(store.apply({ type: 'create-profile', name: 'Must not commit' })).rejects.toThrow()
    expect(store.get()).toEqual(before)
    expect(await readFile(path, 'utf8')).toBe(original)
    expect((await readdir(dirname(path))).sort()).toEqual(['config.json', 'config.json.bak'])
    await rm(`${path}.bak`, { recursive: true })
    const recovered = await store.apply({ type: 'create-profile', name: 'Committed' })
    expect(recovered.profiles[1].id).toBe(2)
    expect(recovered.nextProfileId).toBe(3)
  })
})

describe('runtime and persisted input validation', () => {
  it.each([
    null,
    { type: 'unknown' },
    { type: 'create-profile', name: '   ' },
    { type: 'create-profile', name: 'x'.repeat(101) },
    { type: 'rename-profile', profileId: 1, name: 'Valid', id: 99 },
    { type: 'activate-profile', profileId: '1' },
    { type: 'activate-profile', profileId: 999 },
    { type: 'delete-region', profileId: 1, regionId: 999 },
    { type: 'add-region', profileId: 1, rectangle: { ...rectangle, x: -1 } },
    { type: 'add-region', profileId: 1, rectangle: { ...rectangle, x: '4' } },
    { type: 'add-region', profileId: 1, rectangle: { ...rectangle, width: 0 } },
    { type: 'add-region', profileId: 1, rectangle: { ...rectangle, height: 1.5 } },
    { type: 'add-region', profileId: 1, rectangle: { ...rectangle, y: NaN } },
    { type: 'add-region', profileId: 1, rectangle: { ...rectangle, x: Number.MAX_SAFE_INTEGER } },
    { type: 'update-region', profileId: 1, regionId: 1, rectangle: { ...rectangle, id: 2 } }
  ])('rejects invalid command without changing memory or files: %j', async (invalid) => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const before = store.get()
    const disk = await readFile(path, 'utf8')
    await expect(store.apply(invalid)).rejects.toThrow()
    expect(store.get()).toEqual(before)
    expect(await readFile(path, 'utf8')).toBe(disk)
    expect(await readdir(dirname(path))).toEqual(['config.json'])
  })

  it.each([
    '{broken json',
    JSON.stringify({ schemaVersion: 2 }),
    JSON.stringify({ schemaVersion: 1, nextProfileId: 2, activeProfileId: 1, profiles: [] }),
    JSON.stringify({
      schemaVersion: 1,
      nextProfileId: 1,
      activeProfileId: 1,
      profiles: [{ id: 1, name: 'Bad counter', nextRegionId: 1, regions: [] }]
    }),
    JSON.stringify({
      schemaVersion: 1,
      nextProfileId: 2,
      activeProfileId: 1,
      profiles: [
        {
          id: 1,
          name: 'Duplicate ROI',
          nextRegionId: 2,
          regions: [
            { id: 1, ...rectangle },
            { id: 1, ...rectangle }
          ]
        }
      ]
    })
  ])('preserves corrupt or unsupported config and its existing backup', async (invalid) => {
    const path = await configPath()
    await writeFile(path, invalid)
    await writeFile(`${path}.bak`, 'untouched recovery data')
    await expect(loadProfileStore(path)).rejects.toThrow(/Cannot load profile config/)
    expect(await readFile(path, 'utf8')).toBe(invalid)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('untouched recovery data')
  })

  it('does not reset a missing config when its backup remains', async () => {
    const path = await configPath()
    await writeFile(`${path}.bak`, 'recovery data')
    await expect(loadProfileStore(path)).rejects.toThrow(/Restore the backup/)
    expect(await readdir(dirname(path))).toEqual(['config.json.bak'])
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('recovery data')
  })

  it('rejects external modification or corruption instead of silently replacing it on save', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const before = store.get()
    const externallyChanged = JSON.stringify({ ...before, nextProfileId: 50 })
    await writeFile(path, externallyChanged)
    await expect(
      store.apply({ type: 'rename-profile', profileId: 1, name: 'Ignored' })
    ).rejects.toThrow(/changed outside/)
    expect(await readFile(path, 'utf8')).toBe(externallyChanged)
    await writeFile(path, 'broken')
    await expect(
      store.apply({ type: 'rename-profile', profileId: 1, name: 'Also ignored' })
    ).rejects.toThrow(/Cannot load profile config/)
    expect(await readFile(path, 'utf8')).toBe('broken')
    expect(store.get()).toEqual(before)
    expect(await readdir(dirname(path))).toEqual(['config.json'])
  })

  it('identifies removed or damaged files as conflicts that require reloading', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const request = { type: 'rename-profile', profileId: 1, name: 'Ignored' }
    const original = store.get()
    await rm(path)
    await expect(store.apply(request)).rejects.toBeInstanceOf(ProfileFileConflictError)
    expect(await readdir(dirname(path))).toEqual([])
    await writeFile(path, '{invalid')
    await expect(store.apply(request)).rejects.toBeInstanceOf(ProfileFileConflictError)
    expect(await readFile(path, 'utf8')).toBe('{invalid')
    expect(store.get()).toEqual(original)
  })
})
