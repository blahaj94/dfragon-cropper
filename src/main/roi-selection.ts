import {
  BrowserWindow,
  ipcMain,
  screen,
  type Display,
  type Event,
  type IpcMainInvokeEvent
} from 'electron'
import { IPC, type PreviewFrame, type Region, type RoiSelection } from '../shared/contracts'
import { validateRegions } from './capture/pixels'
import { isWindowRequest, restrictWindow } from './window-security'

export function validateSelectionRectangle(
  value: unknown,
  frame: Pick<PreviewFrame, 'width' | 'height'>
): Omit<Region, 'id'> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 ||
    !['x', 'y', 'width', 'height'].every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error('ROI selection must contain exactly x, y, width and height.')
  }
  const rectangle = value as Omit<Region, 'id'>
  validateRegions([{ id: 1, ...rectangle }], frame)
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height
  }
}

interface SelectionSession {
  window: BrowserWindow
  documentUrl: string
  frame: PreviewFrame
  finishing: boolean
  settled: boolean
  settle(result: RoiSelection | null, error?: Error): void
}

/** One ephemeral, isolated window owns one immutable frame and one selection result. */
export class RoiSelectionWindow {
  private session: SelectionSession | null = null

  constructor(
    private readonly options: { documentUrl: () => string; preload: string; icon: string }
  ) {
    ipcMain.handle(IPC.overlayFrame, (event, ...args) => {
      const session = this.trustedSession(event, args, 0)
      return session.frame
    })
    ipcMain.handle(IPC.overlayFinish, (event, ...args) => {
      const session = this.trustedSession(event, args, 1)
      const rectangle = args[0] === null ? null : validateSelectionRectangle(args[0], session.frame)
      session.finishing = true
      // Return the IPC acknowledgement before destroying its renderer context.
      setImmediate(() =>
        session.settle(
          rectangle
            ? {
                rectangle,
                width: session.frame.width,
                height: session.frame.height,
                capturedAt: session.frame.capturedAt
              }
            : null
        )
      )
    })
  }

  private trustedSession(
    event: IpcMainInvokeEvent,
    args: unknown[],
    argumentCount: number
  ): SelectionSession {
    const session = this.session
    if (
      !session ||
      session.finishing ||
      args.length !== argumentCount ||
      !isWindowRequest(event, session.window, session.documentUrl) ||
      event.sender.session !== session.window.webContents.session
    )
      throw new Error('Untrusted or unavailable ROI overlay request.')
    return session
  }

  cancel(): void {
    this.session?.settle(null)
  }

  open(frame: PreviewFrame): Promise<RoiSelection | null> {
    if (this.session) throw new Error('A screen selection is already open.')
    const display = screen.getPrimaryDisplay()
    const documentUrl = new URL(this.options.documentUrl())
    documentUrl.hash = 'roi-overlay'
    const overlay = this.createWindow(display)
    let resolveResult!: (selection: RoiSelection | null) => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<RoiSelection | null>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    let focused = false
    const loadTimeout = setTimeout(
      () => session.settle(null, new Error('The screen selection window could not load.')),
      15_000
    )
    const displayChanged = () => session.settle(null)
    const displayMetricsChanged = (_event: Event, changedDisplay: Display, metrics: string[]) => {
      // Fullscreen itself changes the work area by hiding system UI. Only changes
      // to this frozen display's coordinate mapping invalidate its selection.
      if (
        changedDisplay.id === display.id &&
        metrics.some((metric) => ['bounds', 'scaleFactor', 'rotation'].includes(metric))
      )
        session.settle(null)
    }
    const session: SelectionSession = {
      window: overlay,
      documentUrl: documentUrl.href,
      frame,
      finishing: false,
      settled: false,
      settle: (selection, error) => {
        if (session.settled) return
        session.settled = true
        clearTimeout(loadTimeout)
        screen.removeListener('display-metrics-changed', displayMetricsChanged)
        screen.removeListener('display-added', displayChanged)
        screen.removeListener('display-removed', displayChanged)
        if (this.session === session) this.session = null
        if (!overlay.isDestroyed()) overlay.destroy()
        if (error) rejectResult(error)
        else resolveResult(selection)
      }
    }
    this.session = session
    screen.on('display-metrics-changed', displayMetricsChanged)
    screen.on('display-added', displayChanged)
    screen.on('display-removed', displayChanged)
    overlay.on('closed', () => session.settle(null))
    overlay.on('focus', () => {
      focused = true
    })
    overlay.on('blur', () => {
      // Initial presentation/focus changes can race. Only cancel a shown overlay
      // after it has actually owned focus and still lacks it on the next turn.
      setImmediate(() => {
        if (!session.settled && focused && !overlay.isDestroyed() && !overlay.isFocused())
          session.settle(null)
      })
    })
    overlay.on('unresponsive', () =>
      session.settle(null, new Error('The screen selection window stopped responding.'))
    )
    overlay.webContents.on('render-process-gone', () =>
      session.settle(null, new Error('The screen selection window closed unexpectedly.'))
    )
    overlay.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        session.settle(null)
      }
    })
    this.presentWindow(session, () => clearTimeout(loadTimeout))
    return result
  }

  private createWindow(display: Display): BrowserWindow {
    const overlay = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      // A fullscreen selection needs no Windows resize border or its frame insets.
      thickFrame: false,
      transparent: false,
      backgroundColor: '#10151c',
      fullscreen: process.platform !== 'darwin',
      simpleFullscreen: process.platform === 'darwin',
      fullscreenable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      icon: this.options.icon,
      webPreferences: {
        preload: this.options.preload,
        additionalArguments: ['--dfragon-roi-overlay'],
        partition: 'dfragon-roi-overlay',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    try {
      overlay.setAlwaysOnTop(true, 'screen-saver')
    } catch (error) {
      overlay.destroy()
      throw error
    }
    restrictWindow(overlay)
    return overlay
  }

  private presentWindow(session: SelectionSession, loaded: () => void): void {
    const overlay = session.window
    void overlay.loadURL(session.documentUrl).then(
      () => {
        loaded()
        if (!session.settled && !overlay.isDestroyed()) {
          try {
            overlay.show()
            // simpleFullscreen chooses the macOS fullscreen style; explicitly
            // enter it after showing, otherwise AppKit can keep the menu-bar inset.
            if (process.platform === 'darwin') overlay.setSimpleFullScreen(true)
            // Electron's border-free Windows fullscreen path applies the display
            // bounds directly. Reapply after showing, once native sizing has run.
            else if (process.platform === 'win32') overlay.setFullScreen(true)
            overlay.focus()
          } catch {
            session.settle(null, new Error('The screen selection window could not be shown.'))
          }
        }
      },
      () => session.settle(null, new Error('The screen selection window could not load.'))
    )
  }
}
