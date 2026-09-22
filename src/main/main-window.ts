import { BrowserWindow, screen } from 'electron'
import { restrictWindow } from './window-security'

/** Desktop presentation only: creation, focus, close behavior and temporary hiding. */
export class MainWindow {
  readonly window: BrowserWindow
  private suspended = false
  private deferredShow = false

  constructor(
    private readonly options: {
      preload: string
      icon: string
      isShuttingDown(): boolean
      closeToTray(): boolean
      nativeSelectionShortcut(): boolean
      requestSelection(): void
      onUnavailable(): void
      quit(): void
    }
  ) {
    const workArea = screen.getPrimaryDisplay().workAreaSize
    const window = new BrowserWindow({
      width: Math.min(1120, workArea.width),
      height: Math.min(860, workArea.height),
      minWidth: Math.min(720, workArea.width),
      minHeight: Math.min(600, workArea.height),
      show: false,
      autoHideMenuBar: true,
      icon: options.icon,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.window = window
    restrictWindow(window)
    window.on('close', (event) => {
      if (options.isShuttingDown()) return
      event.preventDefault()
      if (options.closeToTray()) window.hide()
      else options.quit()
    })
    window.on('closed', options.onUnavailable)
    window.webContents.on('render-process-gone', options.onUnavailable)
    window.webContents.on('before-input-event', (event, input) => {
      if (!options.nativeSelectionShortcut() && input.key === 'F12') {
        event.preventDefault()
        if (input.type === 'keyDown' && !input.isAutoRepeat) options.requestSelection()
      }
    })
  }

  show(): void {
    if (this.options.isShuttingDown() || this.window.isDestroyed()) return
    if (this.suspended) {
      this.deferredShow = true
      return
    }
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  hideTemporarily(): { wasVisible: boolean; restore(reveal: boolean): void } {
    const wasVisible = this.window.isVisible() && !this.window.isMinimized()
    this.suspended = true
    if (wasVisible) this.window.hide()
    return {
      wasVisible,
      restore: (reveal) => {
        this.suspended = false
        const shouldShow = reveal || wasVisible || this.deferredShow
        this.deferredShow = false
        if (shouldShow) this.show()
      }
    }
  }
}
