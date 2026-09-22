import { createHash } from 'node:crypto'
import type { GroundTruthCapture, GroundTruthCommand } from '../../shared/contracts'
import { GROUND_TRUTH_TEXT_LIMIT } from '../../shared/ground-truth'
import { MAX_METADATA_BYTES, positiveInteger, type loadEvent } from '../capture/history/metadata'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ground truth must be an object.')
  return value as Record<string, unknown>
}

export function revision(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function opaqueId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`Invalid ${label}. Reload the ground truth library.`)
  return value
}

export function nickname(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > GROUND_TRUTH_TEXT_LIMIT)
    throw new Error(
      `Nickname must be text or null, with at most ${GROUND_TRUTH_TEXT_LIMIT} characters.`
    )
  return value.trim() ? value : null
}

export function parseGroundTruthCommand(value: unknown): GroundTruthCommand {
  const input = object(value)
  const keys = Object.keys(input)
  if (
    keys.length !== 4 ||
    keys.some((key) => !['captureKey', 'regionId', 'text', 'revision'].includes(key))
  )
    throw new Error('Invalid ground truth save command.')
  return {
    captureKey: opaqueId(input.captureKey, 'capture key'),
    regionId: positiveInteger(input.regionId, 'ROI ID'),
    text: nickname(input.text),
    revision: opaqueId(input.revision, 'capture revision')
  }
}

/** Absence is the legacy format. An unsupported annotation block stays read-only. */
export function readAnswers(
  metadata: Record<string, unknown>,
  regionIds: number[]
): Record<string, string | null> {
  if (metadata.groundTruth === undefined) return {}
  const groundTruth = object(metadata.groundTruth)
  if (groundTruth.schemaVersion !== 1)
    throw new Error('Unsupported ground truth schema. Existing answers were not changed.')
  const values = object(groundTruth.regions)
  for (const [key, value] of Object.entries(values)) {
    const id = Number(key)
    if (!Number.isSafeInteger(id) || id < 1 || String(id) !== key || !regionIds.includes(id))
      throw new Error('Ground truth refers to an unknown ROI.')
    // Saved blank strings are read as unanswered, without rewriting imported metadata.
    nickname(value)
  }
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, nickname(value)]))
}

export function groundTruthCapture(
  key: string,
  event: Awaited<ReturnType<typeof loadEvent>>
): GroundTruthCapture {
  let answers: Record<string, string | null> = {}
  let annotationError: string | undefined
  try {
    answers = readAnswers(
      event.metadata,
      event.summary.regions.map((region) => region.id)
    )
  } catch (error) {
    annotationError = error instanceof Error ? error.message : String(error)
  }
  return {
    key,
    eventId: event.summary.eventId,
    capturedAt: event.summary.capturedAt,
    revision: revision(event.bytes),
    regions: event.summary.regions.map(({ id, x, y, width, height }) => ({
      id,
      x,
      y,
      width,
      height,
      text: answers[id] ?? null
    })),
    ...(event.summary.profile ? { profile: event.summary.profile } : {}),
    ...(annotationError ? { annotationError } : {})
  }
}

export function updatedMetadata(
  event: Awaited<ReturnType<typeof loadEvent>>,
  regionId: number,
  text: string | null
): Buffer {
  if (!event.summary.regions.some((region) => region.id === regionId))
    throw new Error('ROI does not exist in this capture event.')
  readAnswers(
    event.metadata,
    event.summary.regions.map((region) => region.id)
  )
  const existing = event.metadata.groundTruth as Record<string, unknown> | undefined
  // Patch the parsed original, preserving capture fields, future fields and other answers.
  const metadata = {
    ...event.metadata,
    groundTruth: {
      ...existing,
      schemaVersion: 1,
      regions: { ...(existing?.regions as object | undefined), [regionId]: text }
    }
  }
  const bytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  if (bytes.length > MAX_METADATA_BYTES)
    throw new Error('Updated capture metadata exceeds its 1 MiB size limit.')
  return bytes
}
