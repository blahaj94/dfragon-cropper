import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { Profile, ProfileCommand, ProfileSettings, Region } from '../../shared/contracts'

export interface ProfileStore {
  get(): ProfileSettings
  apply(command: unknown): Promise<ProfileSettings>
}

/** The previously loaded file is no longer safe to overwrite; the app must reload it. */
export class ProfileFileConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProfileFileConflictError'
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (
    Object.keys(value).length !== allowed.length ||
    allowed.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`Expected only these fields: ${allowed.join(', ')}.`)
  }
}

function integer(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer of at least ${minimum}.`)
  }
  return value
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new Error('Profile name must contain between 1 and 100 characters after trimming.')
  }
  return value.trim()
}

function rectangle(value: unknown): Omit<Region, 'id'> {
  const input = object(value, 'ROI rectangle')
  keys(input, ['x', 'y', 'width', 'height'])
  const result = {
    x: integer(input.x, 'ROI x', 0),
    y: integer(input.y, 'ROI y', 0),
    width: integer(input.width, 'ROI width'),
    height: integer(input.height, 'ROI height')
  }
  if (
    !Number.isSafeInteger(result.x + result.width) ||
    !Number.isSafeInteger(result.y + result.height)
  ) {
    throw new Error('ROI right and bottom edges must be safe integers.')
  }
  return result
}

function command(value: unknown): ProfileCommand {
  const input = object(value, 'Profile command')
  switch (input.type) {
    case 'create-profile':
      keys(input, ['type', 'name'])
      return { type: input.type, name: name(input.name) }
    case 'rename-profile':
      keys(input, ['type', 'profileId', 'name'])
      return {
        type: input.type,
        profileId: integer(input.profileId, 'Profile ID'),
        name: name(input.name)
      }
    case 'delete-profile':
    case 'activate-profile':
      keys(input, ['type', 'profileId'])
      return { type: input.type, profileId: integer(input.profileId, 'Profile ID') }
    case 'add-region':
      keys(input, ['type', 'profileId', 'rectangle'])
      return {
        type: input.type,
        profileId: integer(input.profileId, 'Profile ID'),
        rectangle: rectangle(input.rectangle)
      }
    case 'update-region':
      keys(input, ['type', 'profileId', 'regionId', 'rectangle'])
      return {
        type: input.type,
        profileId: integer(input.profileId, 'Profile ID'),
        regionId: integer(input.regionId, 'ROI ID'),
        rectangle: rectangle(input.rectangle)
      }
    case 'delete-region':
      keys(input, ['type', 'profileId', 'regionId'])
      return {
        type: input.type,
        profileId: integer(input.profileId, 'Profile ID'),
        regionId: integer(input.regionId, 'ROI ID')
      }
    default:
      throw new Error('Unknown profile command.')
  }
}

function parseSettings(text: string): ProfileSettings {
  try {
    const input = object(JSON.parse(text), 'Config')
    if (input.schemaVersion !== 1) throw new Error('Unsupported config schemaVersion; expected 1.')
    keys(input, ['schemaVersion', 'nextProfileId', 'activeProfileId', 'profiles'])
    const nextProfileId = integer(input.nextProfileId, 'Next profile ID')
    if (!Array.isArray(input.profiles)) throw new Error('Profiles must be an array.')
    const profileIds = new Set<number>()
    const profiles: Profile[] = input.profiles.map((value) => {
      const profile = object(value, 'Profile')
      keys(profile, ['id', 'name', 'nextRegionId', 'regions'])
      const id = integer(profile.id, 'Profile ID')
      if (profileIds.has(id) || id >= nextProfileId) {
        throw new Error('Profile IDs must be unique and lower than nextProfileId.')
      }
      profileIds.add(id)
      const nextRegionId = integer(profile.nextRegionId, 'Next ROI ID')
      if (!Array.isArray(profile.regions)) throw new Error('Regions must be an array.')
      const regionIds = new Set<number>()
      const regions: Region[] = profile.regions.map((value) => {
        const region = object(value, 'ROI')
        keys(region, ['id', 'x', 'y', 'width', 'height'])
        const regionId = integer(region.id, 'ROI ID')
        if (regionIds.has(regionId) || regionId >= nextRegionId) {
          throw new Error('ROI IDs must be unique within a profile and lower than nextRegionId.')
        }
        regionIds.add(regionId)
        return {
          id: regionId,
          ...rectangle({ x: region.x, y: region.y, width: region.width, height: region.height })
        }
      })
      return { id, name: name(profile.name), nextRegionId, regions }
    })
    const activeProfileId =
      input.activeProfileId === null ? null : integer(input.activeProfileId, 'Active profile ID')
    if (
      (activeProfileId === null && profiles.length > 0) ||
      (activeProfileId !== null && !profileIds.has(activeProfileId))
    ) {
      throw new Error(
        'Active profile must reference an existing profile, or be null when no profiles remain.'
      )
    }
    return { schemaVersion: 1, nextProfileId, activeProfileId, profiles }
  } catch (error) {
    throw new Error(
      `Cannot load profile config: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

function defaults(): ProfileSettings {
  return {
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
  }
}

function applyCommand(settings: ProfileSettings, request: ProfileCommand): void {
  if (request.type === 'create-profile') {
    if (settings.nextProfileId === Number.MAX_SAFE_INTEGER)
      throw new Error('Profile ID limit reached.')
    const id = settings.nextProfileId++
    settings.profiles.push({ id, name: request.name, nextRegionId: 1, regions: [] })
    settings.activeProfileId = id
    return
  }
  const index = settings.profiles.findIndex((profile) => profile.id === request.profileId)
  const profile = settings.profiles[index]
  if (!profile) throw new Error(`Profile ${request.profileId} does not exist.`)
  switch (request.type) {
    case 'rename-profile':
      profile.name = request.name
      break
    case 'activate-profile':
      settings.activeProfileId = profile.id
      break
    case 'delete-profile':
      settings.profiles.splice(index, 1)
      if (settings.activeProfileId === profile.id) {
        settings.activeProfileId = settings.profiles[index]?.id ?? settings.profiles[0]?.id ?? null
      }
      break
    case 'add-region':
      if (profile.nextRegionId === Number.MAX_SAFE_INTEGER) throw new Error('ROI ID limit reached.')
      profile.regions.push({ id: profile.nextRegionId++, ...request.rectangle })
      break
    case 'update-region':
    case 'delete-region': {
      const regionIndex = profile.regions.findIndex((region) => region.id === request.regionId)
      if (regionIndex < 0)
        throw new Error(`ROI ${request.regionId} does not exist in profile ${profile.id}.`)
      if (request.type === 'update-region') {
        profile.regions[regionIndex] = { id: request.regionId, ...request.rectangle }
      } else {
        profile.regions.splice(regionIndex, 1)
      }
      break
    }
  }
}

/** Same-directory rename publishes a complete file; flush before replacing the destination. */
async function atomicWrite(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(text, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } finally {
    await handle?.close()
    await rm(temporary, { force: true })
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function loadProfileStore(configPath: string): Promise<ProfileStore> {
  const path = resolve(configPath)
  const backupPath = `${path}.bak`
  let storedText: string
  let current: ProfileSettings
  try {
    storedText = await readFile(path, 'utf8')
  } catch (error) {
    if (!missing(error)) throw error
    // A surviving backup is user data, not permission to reset a missing config to defaults.
    let backupExists = true
    try {
      await stat(backupPath)
    } catch (backupError) {
      if (!missing(backupError)) throw backupError
      backupExists = false
    }
    if (backupExists) {
      throw new Error(
        'Profile config is missing but config.json.bak exists. Restore the backup before continuing.'
      )
    }
    storedText = `${JSON.stringify(defaults(), null, 2)}\n`
    await mkdir(dirname(path), { recursive: true })
    await atomicWrite(path, storedText)
  }
  current = parseSettings(storedText)
  let pending: Promise<unknown> = Promise.resolve()
  return {
    get: () => structuredClone(current),
    async apply(input: unknown): Promise<ProfileSettings> {
      // Parse now to detach queued commands from caller-owned mutable objects.
      const request = command(input)
      const operation = pending.then(async () => {
        const next = structuredClone(current)
        applyCommand(next, request)
        let previousText: string
        try {
          previousText = await readFile(path, 'utf8')
          parseSettings(previousText)
        } catch (error) {
          throw new ProfileFileConflictError(
            `Profile config can no longer be read safely. ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        }
        if (previousText !== storedText) {
          throw new ProfileFileConflictError(
            'Profile config changed outside this app. Reload it before editing; no files were overwritten.'
          )
        }
        const nextText = `${JSON.stringify(next, null, 2)}\n`
        // The backup remains a complete last-known-good config even if the next write fails.
        await atomicWrite(backupPath, previousText)
        await atomicWrite(path, nextText)
        current = next
        storedText = nextText
        return structuredClone(current)
      })
      // A failed edit must neither commit its draft nor poison subsequent edits.
      pending = operation.catch(() => undefined)
      return operation
    }
  }
}
