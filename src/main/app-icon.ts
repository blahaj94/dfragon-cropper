import { app } from 'electron'
import { join } from 'node:path'

export function applicationIconPath(): string {
  const resources = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  return join(resources, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}
