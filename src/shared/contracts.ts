import type { GroundTruthApi } from './ground-truth'

export { GROUND_TRUTH_TEXT_LIMIT } from './ground-truth'
export type {
  GroundTruthApi,
  GroundTruthCapture,
  GroundTruthCommand,
  GroundTruthPage,
  GroundTruthSaveResult
} from './ground-truth'

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
  schemaVersion: 2
  nextProfileId: number
  activeProfileId: number | null
  profiles: Profile[]
  preferences: { saveOriginal: boolean; closeToTray: boolean }
}

export type ProfileCommand =
  | { type: 'set-preferences'; saveOriginal: boolean; closeToTray: boolean }
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
  originalSaved?: boolean
}

export interface PreviewFrame {
  width: number
  height: number
  capturedAt: string
  dataUrl: string
}

export interface RoiSelection {
  rectangle: Omit<Region, 'id'>
  width: number
  height: number
  capturedAt: string
}

export interface RoiOverlayApi {
  getFrame(): Promise<PreviewFrame>
  finish(rectangle: Omit<Region, 'id'> | null): Promise<void>
}

export interface CaptureHistory {
  events: CaptureSummary[]
  skippedEntries: number
  hasMore: boolean
}

export interface SpikeState {
  platform: string
  mode: 'keyboard-hook' | 'global-shortcut' | 'fixture' | 'unsupported'
  triggerStatus: string
  selectionShortcutStatus: string
  busy: boolean
  completed: number
  failed: number
  skipped: number
  lastCapture: CaptureSummary | null
  error: string | null
  settings: ProfileSettings | null
  settingsError: string | null
  outputDirectory: string
  backgroundAvailable: boolean
}

export interface SpikeApi extends GroundTruthApi {
  getState(): Promise<SpikeState>
  captureNow(): Promise<SpikeState>
  onState(callback: (state: SpikeState) => void): () => void
  updateProfiles(command: ProfileCommand): Promise<SpikeState>
  selectRoi(): Promise<RoiSelection | null>
  onSelectRoiRequested(callback: () => void): () => void
  listCaptures(): Promise<CaptureHistory>
  readCaptureImage(eventId: string, regionId: number | null): Promise<string>
  openCaptureFolder(eventId?: string): Promise<void>
  minimizeToTray(): Promise<void>
  quit(): Promise<void>
}

export const IPC = {
  getState: 'spike:get-state',
  captureNow: 'spike:capture-now',
  state: 'spike:state',
  updateProfiles: 'profiles:update',
  selectRoi: 'roi:select',
  selectRoiRequested: 'roi:requested',
  overlayFrame: 'roi-overlay:frame',
  overlayFinish: 'roi-overlay:finish',
  listCaptures: 'capture:list',
  readCaptureImage: 'capture:image',
  openCaptureFolder: 'capture:open-folder',
  listGroundTruthCaptures: 'ground-truth:list',
  readGroundTruthCapture: 'ground-truth:read',
  readGroundTruthImage: 'ground-truth:image',
  saveGroundTruth: 'ground-truth:save',
  minimizeToTray: 'app:hide',
  quit: 'app:quit'
} as const
