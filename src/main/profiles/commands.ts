import type { ProfileCommand, ProfileSettings } from '../../shared/contracts'

export function defaultSettings(): ProfileSettings {
  return {
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
  }
}

export function applyProfileCommand(settings: ProfileSettings, request: ProfileCommand): void {
  if (request.type === 'set-preferences') {
    settings.preferences = { saveOriginal: request.saveOriginal, closeToTray: request.closeToTray }
    return
  }
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
