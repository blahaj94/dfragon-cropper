import type { Profile, ProfileCommand, ProfileSettings, Region } from '../../shared/contracts'
import { defaultShortcuts, parseShortcutSettings } from '../../shared/shortcuts'

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

function preferences(value: unknown): ProfileSettings['preferences'] {
  const input = object(value, 'Preferences')
  keys(input, ['saveOriginal', 'closeToTray'])
  if (typeof input.saveOriginal !== 'boolean' || typeof input.closeToTray !== 'boolean') {
    throw new Error('saveOriginal and closeToTray must be booleans.')
  }
  return { saveOriginal: input.saveOriginal, closeToTray: input.closeToTray }
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

export function parseProfileCommand(value: unknown): ProfileCommand {
  const input = object(value, 'Profile command')
  switch (input.type) {
    case 'set-shortcuts':
      keys(input, ['type', 'shortcuts'])
      return { type: input.type, shortcuts: parseShortcutSettings(input.shortcuts) }
    case 'set-preferences':
      keys(input, ['type', 'saveOriginal', 'closeToTray'])
      return {
        type: input.type,
        ...preferences({ saveOriginal: input.saveOriginal, closeToTray: input.closeToTray })
      }
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

export function parseSettings(text: string): {
  settings: ProfileSettings
  sourceVersion: 1 | 2 | 3
} {
  try {
    const input = object(JSON.parse(text), 'Config')
    if (input.schemaVersion !== 1 && input.schemaVersion !== 2 && input.schemaVersion !== 3) {
      throw new Error('Unsupported config schemaVersion; expected 1, 2 or 3.')
    }
    const sourceVersion = input.schemaVersion
    keys(input, [
      'schemaVersion',
      'nextProfileId',
      'activeProfileId',
      'profiles',
      ...(sourceVersion >= 2 ? ['preferences'] : []),
      ...(sourceVersion === 3 ? ['shortcuts'] : [])
    ])
    const savedPreferences =
      sourceVersion === 1
        ? { saveOriginal: true, closeToTray: true }
        : preferences(input.preferences)
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
      // Validate without rewriting a persisted name during migration or a later read.
      name(profile.name)
      return { id, name: profile.name as string, nextRegionId, regions }
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
    return {
      sourceVersion,
      settings: {
        schemaVersion: 3,
        nextProfileId,
        activeProfileId,
        profiles,
        preferences: savedPreferences,
        shortcuts: sourceVersion === 3 ? parseShortcutSettings(input.shortcuts) : defaultShortcuts()
      }
    }
  } catch (error) {
    throw new Error(
      `Cannot load profile config: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}
