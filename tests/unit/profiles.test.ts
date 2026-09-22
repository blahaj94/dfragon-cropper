import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProfileStore, ProfileFileConflictError } from '../../src/main/profiles'
import { createProfileController } from '../../src/main/profiles/controller'
import type { SpikeState } from '../../src/shared/contracts'

const renameFailure = vi.hoisted(() => ({ target: null as string | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (args[1] === renameFailure.target) {
        throw Object.assign(new Error('Simulated config replacement failure'), { code: 'EACCES' })
      }
      return actual.rename(...args)
    }
  }
})

const directories: string[] = []
afterEach(async () => {
  renameFailure.target = null
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
const legacySettings = {
  schemaVersion: 1,
  nextProfileId: 40,
  activeProfileId: 17,
  profiles: [
    {
      id: 4,
      name: '  Legacy profile  ',
      nextRegionId: 19,
      regions: [
        { id: 8, ...rectangle },
        { id: 15, ...rectangle, x: 27 }
      ]
    },
    { id: 17, name: 'Empty profile', nextRegionId: 12, regions: [] }
  ]
}

function controllerFixture(path: string) {
  const state: SpikeState = {
    platform: 'test',
    mode: 'fixture',
    triggerStatus: 'Synthetic fixture',
    selectionShortcutStatus: 'Synthetic fixture',
    busy: false,
    completed: 0,
    failed: 0,
    skipped: 0,
    lastCapture: null,
    error: 'Earlier capture error',
    settings: null,
    settingsError: null,
    outputDirectory: dirname(path),
    backgroundAvailable: false
  }
  const publish = vi.fn()
  const logger = { write: vi.fn() }
  const selectionActive = vi.fn(() => false)
  return {
    state,
    publish,
    logger,
    selectionActive,
    controller: createProfileController({
      state,
      configPath: path,
      publish,
      logger,
      selectionActive
    })
  }
}

describe('profile application controller', () => {
  it('preserves saved state on selection or write failures and publishes only committed edits', async () => {
    const path = await configPath()
    const { controller, state, selectionActive, publish, logger } = controllerFixture(path)
    await controller.load()
    const saved = structuredClone(state.settings)
    const request = { type: 'rename-profile', profileId: 1, name: 'Saved name' }
    selectionActive.mockReturnValue(true)
    await expect(controller.update(request)).rejects.toThrow('Finish or cancel screen selection')
    expect(logger.write).not.toHaveBeenCalled()
    selectionActive.mockReturnValue(false)
    renameFailure.target = path
    await expect(controller.update(request)).rejects.toThrow('Simulated config replacement failure')
    expect(state.settings).toEqual(saved)
    expect(state.settingsError).toBeNull()
    expect(state.error).toBe('Earlier capture error')
    expect(publish).not.toHaveBeenCalled()
    expect(logger.write).toHaveBeenCalledWith('settings.save-failed', expect.any(Object))
    renameFailure.target = null
    // Capture-time updates remain allowed; only a screen selection blocks editing.
    state.busy = true
    expect(await controller.update(request)).toBe(state)
    expect(state.settings?.profiles[0].name).toBe('Saved name')
    expect(state.error).toBeNull()
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('publishes external-file conflicts and reports load errors without replacing damaged data', async () => {
    const path = await configPath()
    const { controller, state, publish, logger } = controllerFixture(path)
    await controller.load()
    const saved = structuredClone(state.settings)
    const damaged = '{broken config'
    await writeFile(path, damaged)
    await expect(
      controller.update({ type: 'rename-profile', profileId: 1, name: 'Not saved' })
    ).rejects.toBeInstanceOf(ProfileFileConflictError)
    expect(state.settings).toEqual(saved)
    expect(state.settingsError).toContain('can no longer be read safely')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(logger.write).toHaveBeenCalledWith('settings.save-failed', expect.any(Object))

    const restarted = controllerFixture(path)
    await restarted.controller.load()
    expect(restarted.state.settings).toBeNull()
    expect(restarted.state.settingsError).toContain('Cannot load profile config')
    expect(restarted.logger.write).toHaveBeenCalledWith('settings.load-failed', expect.any(Object))
    await expect(
      restarted.controller.update({ type: 'create-profile', name: 'Blocked' })
    ).rejects.toThrow('Cannot load profile config')
    expect(await readFile(path, 'utf8')).toBe(damaged)
  })
})

describe('persistent profile editing', () => {
  it('creates the default config once and returns detached snapshots', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    expect(store.get()).toEqual({
      schemaVersion: 2,
      nextProfileId: 2,
      activeProfileId: 1,
      preferences: { saveOriginal: true, closeToTray: true },
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
    snapshot.preferences.saveOriginal = false
    expect(store.get().profiles[0].regions[0].x).toBe(16)
    expect(store.get().preferences.saveOriginal).toBe(true)
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

  it('serializes preference changes with profile edits and preserves the previous valid backup', async () => {
    const path = await configPath()
    const store = await loadProfileStore(path)
    const preferenceInput = { type: 'set-preferences', saveOriginal: false, closeToTray: false }
    const first = store.apply(preferenceInput)
    preferenceInput.saveOriginal = true
    const second = store.apply({
      type: 'rename-profile',
      profileId: 1,
      name: 'Retained preferences'
    })
    const [preferencesSaved, renamed] = await Promise.all([first, second])
    expect(preferencesSaved.preferences).toEqual({ saveOriginal: false, closeToTray: false })
    expect(renamed.preferences).toEqual(preferencesSaved.preferences)
    expect(JSON.parse(await readFile(`${path}.bak`, 'utf8'))).toEqual(preferencesSaved)
    expect((await loadProfileStore(path)).get()).toEqual(renamed)
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

describe('version 1 migration', () => {
  it('preserves profiles, gaps, counters and exact legacy backup while adding enabled defaults', async () => {
    const path = await configPath()
    const original = `${JSON.stringify(legacySettings, null, 4)}\n\n`
    await writeFile(path, original)
    await writeFile(`${path}.bak`, 'older backup is replaced only after v1 validation')
    const store = await loadProfileStore(path)
    const expected = {
      ...legacySettings,
      schemaVersion: 2,
      preferences: { saveOriginal: true, closeToTray: true }
    }
    expect(store.get()).toEqual(expected)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    const migrated = await readFile(path, 'utf8')
    expect((await loadProfileStore(path)).get()).toEqual(expected)
    expect(await readFile(path, 'utf8')).toBe(migrated)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    await store.apply({ type: 'add-region', profileId: 4, rectangle })
    expect(store.get().profiles[0].regions.at(-1)?.id).toBe(19)
    await store.apply({ type: 'create-profile', name: 'After migration' })
    expect(store.get().profiles.at(-1)?.id).toBe(40)
  })

  it('migrates an empty legacy config without resurrecting deleted IDs or profiles', async () => {
    const path = await configPath()
    const legacy = { schemaVersion: 1, nextProfileId: 83, activeProfileId: null, profiles: [] }
    const original = JSON.stringify(legacy)
    await writeFile(path, original)
    const store = await loadProfileStore(path)
    expect(store.get()).toEqual({
      ...legacy,
      schemaVersion: 2,
      preferences: { saveOriginal: true, closeToTray: true }
    })
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    const created = await store.apply({ type: 'create-profile', name: 'New' })
    expect(created.profiles[0].id).toBe(83)
  })

  it('leaves the legacy file and existing backup untouched when backup replacement fails', async () => {
    const path = await configPath()
    const original = JSON.stringify(legacySettings)
    await writeFile(path, original)
    await mkdir(`${path}.bak`)
    await writeFile(join(`${path}.bak`, 'recovery-data'), 'preserved')
    await expect(loadProfileStore(path)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await readFile(join(`${path}.bak`, 'recovery-data'), 'utf8')).toBe('preserved')
    expect((await readdir(dirname(path))).sort()).toEqual(['config.json', 'config.json.bak'])
  })

  it('retains complete v1 copies if publishing v2 fails and can migrate on a later retry', async () => {
    const path = await configPath()
    const original = `${JSON.stringify(legacySettings)}\n`
    await writeFile(path, original)
    renameFailure.target = path
    await expect(loadProfileStore(path)).rejects.toThrow('Simulated config replacement failure')
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    expect((await readdir(dirname(path))).sort()).toEqual(['config.json', 'config.json.bak'])
    renameFailure.target = null
    expect((await loadProfileStore(path)).get().schemaVersion).toBe(2)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
  })
})

describe('runtime and persisted input validation', () => {
  it.each([
    null,
    { type: 'unknown' },
    { type: 'set-preferences', saveOriginal: false },
    { type: 'set-preferences', saveOriginal: 'false', closeToTray: true },
    { type: 'set-preferences', saveOriginal: true, closeToTray: 0 },
    { type: 'set-preferences', saveOriginal: true, closeToTray: false, profiles: [] },
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
    JSON.stringify({ schemaVersion: 99 }),
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

  it.each([
    undefined,
    null,
    { saveOriginal: true },
    { saveOriginal: 'true', closeToTray: true },
    { saveOriginal: true, closeToTray: null },
    { saveOriginal: true, closeToTray: true, futureOption: false }
  ])(
    'rejects malformed v2 preferences without replacing its config or backup: %j',
    async (preferences) => {
      const path = await configPath()
      const invalid = JSON.stringify({ ...legacySettings, schemaVersion: 2, preferences })
      await writeFile(path, invalid)
      await writeFile(`${path}.bak`, 'preserved valid recovery copy')
      await expect(loadProfileStore(path)).rejects.toThrow(/Cannot load profile config/)
      expect(await readFile(path, 'utf8')).toBe(invalid)
      expect(await readFile(`${path}.bak`, 'utf8')).toBe('preserved valid recovery copy')
    }
  )

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
