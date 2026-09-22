import { Menu, Tray } from 'electron'

export function createAppTray(options: {
  icon: string
  showWindow(): void
  openCaptureFolder(): Promise<void>
  onFolderError(error: unknown): void
  quit(): void
}): Tray {
  const tray = new Tray(options.icon)
  try {
    tray.setToolTip('DFragonCropper')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open DFragonCropper', click: options.showWindow },
        {
          label: 'Open capture folder',
          click: () => void options.openCaptureFolder().catch(options.onFolderError)
        },
        { type: 'separator' },
        { label: 'Quit', click: options.quit }
      ])
    )
    tray.on('double-click', options.showWindow)
    return tray
  } catch (error) {
    tray.destroy()
    throw error
  }
}
