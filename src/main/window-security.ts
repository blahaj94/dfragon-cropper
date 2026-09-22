import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

/** Shared window hardening; domain permissions and argument values stay with their handlers. */
export function restrictWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
}

export function isWindowRequest(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  documentUrl: string
): boolean {
  return (
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.url === documentUrl
  )
}
