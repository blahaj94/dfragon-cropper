import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export function eventTimestamp(eventId: unknown): string {
  if (typeof eventId !== 'string' || !/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(eventId)) {
    throw new Error('Invalid capture event ID.')
  }
  const timestamp = `${eventId.slice(0, 4)}-${eventId.slice(4, 6)}-${eventId.slice(6, 8)}T${eventId.slice(9, 11)}:${eventId.slice(11, 13)}:${eventId.slice(13, 15)}`
  const date = new Date(`${timestamp}Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== timestamp) {
    throw new Error('Capture event ID contains an invalid timestamp.')
  }
  return timestamp
}

export async function captureRoot(outputRoot: string): Promise<string> {
  const path = resolve(outputRoot)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Capture root must be a real directory, not a link.')
  return realpath(path)
}

export async function eventFolder(root: string, eventId: string): Promise<string> {
  eventTimestamp(eventId)
  const path = join(root, eventId)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Capture event must be a real directory, not a link.')
  const actual = await realpath(path)
  if (actual !== path || dirname(actual) !== root)
    throw new Error('Capture event escapes its output directory.')
  return path
}

export async function imageFile(folder: string, filename: string): Promise<string> {
  // Callers only pass fixed metadata.json/original.png or roiFilename(validated integer).
  const path = join(folder, filename)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error('Capture files must be regular files, not links.')
  if ((await realpath(path)) !== path || dirname(path) !== folder)
    throw new Error('Capture file escapes its event directory.')
  return path
}

/** Open a checked regular file and cap reads before allocation, including a file that grows. */
export async function readLimited(
  folder: string,
  filename: string,
  limit: number
): Promise<Buffer> {
  const path = await imageFile(folder, filename)
  const before = await lstat(path)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      before.isSymbolicLink() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new Error('Capture file changed while opening it.')
    }
    // Recheck containment before reading, including a directory replaced with a link.
    if ((await realpath(path)) !== path || (await lstat(folder)).isSymbolicLink()) {
      throw new Error('Capture file path changed while opening it.')
    }
    if (opened.size <= 0 || opened.size > limit)
      throw new Error(`Capture file exceeds its ${limit} byte limit or is empty.`)
    const bytes = Buffer.allocUnsafe(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error('Capture file was truncated while reading it.')
      offset += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error('Capture file changed while reading it.')
    return bytes
  } finally {
    await handle.close()
  }
}
