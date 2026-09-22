import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { ProfileSettings } from '../../shared/contracts'
import { applyProfileCommand, defaultSettings } from './commands'
import { parseProfileCommand, parseSettings } from './validation'

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

async function requireUnchangedFile(path: string, storedText: string): Promise<string> {
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
  return previousText
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
    storedText = `${JSON.stringify(defaultSettings(), null, 2)}\n`
    await mkdir(dirname(path), { recursive: true })
    await atomicWrite(path, storedText)
  }
  const parsed = parseSettings(storedText)
  current = parsed.settings
  if (parsed.sourceVersion === 1) {
    // Only a fully validated v1 file is migrated; preserve its exact original bytes first.
    const original = await requireUnchangedFile(path, storedText)
    const migrated = `${JSON.stringify(current, null, 2)}\n`
    await atomicWrite(backupPath, original)
    await atomicWrite(path, migrated)
    storedText = migrated
  }
  let pending: Promise<unknown> = Promise.resolve()
  return {
    get: () => structuredClone(current),
    async apply(input: unknown): Promise<ProfileSettings> {
      // Parse now to detach queued commands from caller-owned mutable objects.
      const request = parseProfileCommand(input)
      const operation = pending.then(async () => {
        const next = structuredClone(current)
        applyProfileCommand(next, request)
        const previousText = await requireUnchangedFile(path, storedText)
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
