import { randomUUID } from 'node:crypto'
import { lstat, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { captureRoot, eventFolder, imageFile, readLimited } from '../capture/history/files'
import { MAX_METADATA_BYTES } from '../capture/history/metadata'
import { revision } from './metadata'

export interface CaptureLocation {
  root: string
  rootIdentity: string
  eventId: string
  folder: string
  folderIdentity: string
}

export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function directoryIdentity(path: string): Promise<string> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Capture directory must not be a link.')
  return `${info.dev}:${info.ino}:${info.birthtimeMs}`
}

export async function locateCapture(root: string, eventId: string): Promise<CaptureLocation> {
  const actualRoot = await captureRoot(root)
  const folder = await eventFolder(actualRoot, eventId)
  return {
    root: actualRoot,
    rootIdentity: await directoryIdentity(actualRoot),
    eventId,
    folder,
    folderIdentity: await directoryIdentity(folder)
  }
}

/** A key pins one physical copy, even when an identical event ID exists in a legacy root. */
export async function requireLocation(location: CaptureLocation): Promise<void> {
  if (
    (await captureRoot(location.root)) !== location.root ||
    (await directoryIdentity(location.root)) !== location.rootIdentity ||
    (await eventFolder(location.root, location.eventId)) !== location.folder ||
    (await directoryIdentity(location.folder)) !== location.folderIdentity
  )
    throw new Error('Capture directory changed. Reload the ground truth library.')
}

async function requireUnchanged(location: CaptureLocation, expected: Buffer): Promise<void> {
  await requireLocation(location)
  const current = await readLimited(location.folder, 'metadata.json', MAX_METADATA_BYTES)
  if (!current.equals(expected))
    throw new Error('Capture metadata changed. Reload this capture before saving again.')
}

async function checkBackup(folder: string): Promise<void> {
  try {
    await imageFile(folder, 'metadata.json.bak')
  } catch (error) {
    if (!missing(error)) throw error
  }
}

async function prepareFile(
  location: CaptureLocation,
  name: string,
  bytes: Buffer
): Promise<string> {
  await requireLocation(location)
  const temporaryName = `.${name}.${randomUUID()}.tmp`
  const path = join(location.folder, temporaryName)
  const handle = await open(path, 'wx', 0o600)
  try {
    // Match the checked path to this exclusive handle before writing through it.
    await requireLocation(location)
    await imageFile(location.folder, temporaryName)
    const opened = await handle.stat()
    const current = await lstat(path)
    if (opened.dev !== current.dev || opened.ino !== current.ino)
      throw new Error('Temporary metadata file changed while opening it.')
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close()
    try {
      await requireLocation(location)
      await rm(path, { force: true })
    } catch {
      // Never clean up through a directory that another program replaced.
    }
    throw error
  }
  await handle.close()
  return path
}

/** Publish complete files only. This is an external-change check, not a cross-process lock. */
export async function saveMetadata(
  location: CaptureLocation,
  previous: Buffer,
  next: Buffer
): Promise<string> {
  let temporary: string | undefined
  let backup: string | undefined
  try {
    await requireUnchanged(location, previous)
    await checkBackup(location.folder)
    temporary = await prepareFile(location, 'metadata.json', next)
    backup = await prepareFile(location, 'metadata.json.bak', previous)
    await requireUnchanged(location, previous)
    await checkBackup(location.folder)
    await rename(backup, join(location.folder, 'metadata.json.bak'))
    backup = undefined
    await requireUnchanged(location, previous)
    await rename(temporary, join(location.folder, 'metadata.json'))
    temporary = undefined
    return revision(next)
  } finally {
    // Do not follow a replaced directory during cleanup. The original folder may require
    // manual removal of an orphaned temp file if another program moved it during the save.
    try {
      await requireLocation(location)
      if (temporary) await rm(temporary, { force: true })
      if (backup) await rm(backup, { force: true })
    } catch {
      // A cleanup failure must not turn an already committed annotation into a failed save.
    }
  }
}
