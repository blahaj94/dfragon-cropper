export interface Region {
  id: number
  x: number
  y: number
  width: number
  height: number
}

export interface Profile {
  id: number
  name: string
  nextRegionId: number
  regions: Region[]
}

export interface ProfileSettings {
  schemaVersion: 1
  nextProfileId: number
  activeProfileId: number | null
  profiles: Profile[]
}

export type ProfileCommand =
  | { type: 'create-profile'; name: string }
  | { type: 'rename-profile'; profileId: number; name: string }
  | { type: 'delete-profile'; profileId: number }
  | { type: 'activate-profile'; profileId: number }
  | { type: 'add-region'; profileId: number; rectangle: Omit<Region, 'id'> }
  | { type: 'update-region'; profileId: number; regionId: number; rectangle: Omit<Region, 'id'> }
  | { type: 'delete-region'; profileId: number; regionId: number }

export interface CaptureSummary {
  eventId: string
  capturedAt: string
  outputDirectory: string
  width: number
  height: number
  trigger: string
  regions: Array<Region & { path: string }>
  profile?: { id: number; name: string }
}

export interface SpikeState {
  platform: string
  mode: 'keyboard-hook' | 'global-shortcut' | 'fixture' | 'unsupported'
  triggerStatus: string
  busy: boolean
  completed: number
  failed: number
  skipped: number
  lastCapture: CaptureSummary | null
  error: string | null
  settings: ProfileSettings | null
  settingsError: string | null
}

export interface SpikeApi {
  getState(): Promise<SpikeState>
  captureNow(): Promise<SpikeState>
  onState(callback: (state: SpikeState) => void): () => void
  updateProfiles(command: ProfileCommand): Promise<SpikeState>
}

export const IPC = {
  getState: 'spike:get-state',
  captureNow: 'spike:capture-now',
  state: 'spike:state',
  updateProfiles: 'profiles:update'
} as const
