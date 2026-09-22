import type { Region } from './contracts'

export const GROUND_TRUTH_TEXT_LIMIT = 500

export interface GroundTruthCapture {
  /** Opaque identity of this capture's physical folder, including its storage root. */
  key: string
  eventId: string
  capturedAt: string
  profile?: { id: number; name: string }
  revision: string
  regions: Array<Region & { text: string | null }>
  annotationError?: string
}

export interface GroundTruthPage {
  events: GroundTruthCapture[]
  nextCursor: string | null
  skippedEntries: number
}

export interface GroundTruthCommand {
  captureKey: string
  regionId: number
  text: string | null
  revision: string
}

export interface GroundTruthSaveResult {
  captureKey: string
  regionId: number
  text: string | null
  revision: string
}

export interface GroundTruthApi {
  listGroundTruthCaptures(cursor: string | null): Promise<GroundTruthPage>
  readGroundTruthCapture(captureKey: string): Promise<GroundTruthCapture>
  readGroundTruthImage(captureKey: string, regionId: number): Promise<string>
  saveGroundTruth(command: GroundTruthCommand): Promise<GroundTruthSaveResult>
}
