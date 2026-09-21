import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Local diagnostics only. Logging failures never turn a saved capture into a failed one. */
export function createLogger(directory: string) {
  let pending: Promise<void> = Promise.resolve()
  return {
    write(event: string, details: Record<string, unknown> = {}): void {
      const line = JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n'
      pending = pending
        .then(async () => {
          await mkdir(directory, { recursive: true })
          const path = join(directory, 'app.log')
          const size = await stat(path).then(
            (info) => info.size,
            () => 0
          )
          if (size > 5 * 1024 * 1024) {
            await rm(join(directory, 'app.previous.log'), { force: true })
            await rename(path, join(directory, 'app.previous.log'))
          }
          await appendFile(path, line, 'utf8')
        })
        .catch((error: unknown) => console.error('Diagnostic log failed:', error))
    },
    flush: () => pending
  }
}
