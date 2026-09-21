import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  shell,
  Tray
} from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join, dirname } from 'node:path'
import { writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  captureAndSave,
  capturePrimaryFrame,
  encodeFramePng,
  type Frame,
  type CaptureTrigger
} from './capture'
import { listCaptures, readCaptureImage, resolveCaptureFolder } from './capture/history'
import { IPC, type CaptureHistory, type PreviewFrame, type SpikeState } from '../shared/contracts'
import { startPrintScreenListener } from './printscreen'
import { loadProfileStore, ProfileFileConflictError, type ProfileStore } from './profiles'
import { createLogger } from './logging'
import { applicationIconPath } from './app-icon'

app.setName('DFragonCropper')
const development = !app.isPackaged
const fixture = development ? process.env.DFRAGON_FIXTURE : undefined
if (development && process.env.DFRAGON_USER_DATA) {
  app.setPath('userData', process.env.DFRAGON_USER_DATA)
}
// Prevent duplicate PrintScreen listeners and concurrent config writers for normal launches.
if (!app.requestSingleInstanceLock()) app.exit(0)
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
const captureRoot = development
  ? process.env.DFRAGON_OUTPUT_DIR || join(app.getAppPath(), '.dev-captures')
  : join(portableRoot, 'captures')
const captureRoots = development
  ? [captureRoot]
  : [captureRoot, join(portableRoot, '.dev-captures')]
const logger = createLogger(
  development ? join(app.getAppPath(), '.dev-logs') : join(portableRoot, 'logs')
)
let window: BrowserWindow | null = null
let documentUrl = ''
let tray: Tray | null = null
let stopPrintScreen = () => {}
let profileStore: ProfileStore | null = null
let shuttingDown = false
let allowQuit = false
let previewHidden = false
let deferredShow = false
const operations = new Set<Promise<unknown>>()
const state: SpikeState = {
  platform: process.platform,
  mode: fixture
    ? 'fixture'
    : process.platform !== 'win32'
      ? 'unsupported'
      : development && process.env.DFRAGON_TRIGGER === 'global-shortcut'
        ? 'global-shortcut'
        : 'keyboard-hook',
  triggerStatus: fixture ? 'Synthetic fixture; Windows capture is not exercised.' : 'Starting…',
  busy: false,
  completed: 0,
  failed: 0,
  skipped: 0,
  lastCapture: null,
  error: null,
  settings: null,
  settingsError: null,
  outputDirectory: captureRoot,
  backgroundAvailable: false
}

function track<T>(operation: Promise<T>): Promise<T> {
  operations.add(operation)
  void operation.then(
    () => operations.delete(operation),
    () => operations.delete(operation)
  )
  return operation
}

function showWindow(): void {
  if (shuttingDown) return
  if (previewHidden) {
    deferredShow = true
    return
  }
  if (window?.isMinimized()) window.restore()
  window?.show()
  window?.focus()
}
app.on('second-instance', showWindow)
app.on('activate', showWindow)

function configPath(): string {
  if (development) {
    return process.env.DFRAGON_CONFIG_FILE || join(app.getAppPath(), '.dev-config', 'config.json')
  }
  return join(portableRoot, 'config.json')
}

function publish(): void {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.state, state)
  tray?.setToolTip(
    `DFragonCropper · ${state.completed} captured${state.error ? ' · Capture error' : ''}`
  )
  if (development && process.env.DFRAGON_STATE_FILE) {
    writeFileSync(process.env.DFRAGON_STATE_FILE, JSON.stringify(state, null, 2))
  }
}

function fixtureFrame(): Frame {
  if (fixture === 'failure') throw new Error('Fixture capture failed')
  const width = 320
  const height = 240
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([x % 256, y % 256, (x + y) % 256, 255], (y * width + x) * 4)
    }
  }
  return { width, height, rgba, capturedAt: new Date().toISOString(), backend: 'fixture' }
}

async function capture(trigger: CaptureTrigger): Promise<SpikeState> {
  if (shuttingDown) return state
  if (state.busy) {
    state.skipped++
    publish()
    return state
  }
  if (state.mode === 'unsupported') return state
  const activeProfile = state.settings?.profiles.find(
    (profile) => profile.id === state.settings?.activeProfileId
  )
  if (state.settingsError || !activeProfile?.regions.length) {
    state.error = state.settingsError || 'Select an active profile with at least one saved ROI.'
    publish()
    return state
  }
  state.busy = true
  state.error = null
  publish()
  try {
    state.lastCapture = await captureAndSave({
      outputRoot: captureRoot,
      trigger,
      profile: { id: activeProfile.id, name: activeProfile.name },
      regions: activeProfile.regions,
      saveOriginal: state.settings?.preferences.saveOriginal ?? true,
      ...(fixture ? { captureFrame: fixtureFrame } : {})
    })
    state.completed++
    logger.write('capture.saved', {
      eventId: state.lastCapture.eventId,
      trigger,
      profileId: activeProfile.id
    })
  } catch (error) {
    state.failed++
    state.error = error instanceof Error ? error.message : String(error)
    logger.write('capture.failed', { trigger, error: state.error })
  } finally {
    state.busy = false
    publish()
  }
  return state
}

async function previewScreen(): Promise<PreviewFrame> {
  if (shuttingDown || state.busy) throw new Error('Wait for the current operation to finish.')
  if (state.mode === 'unsupported') throw new Error('Screen preview requires Windows 10.')
  state.busy = true
  publish()
  const restore = !fixture && window?.isVisible() && !window.isMinimized()
  try {
    if (restore) {
      previewHidden = true
      window?.hide()
      // Allow the desktop compositor to remove our window before taking the preview frame.
      await new Promise((accept) => setTimeout(accept, 200))
    }
    const frame = fixture ? fixtureFrame() : capturePrimaryFrame()
    return {
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      dataUrl: `data:image/png;base64,${encodeFramePng(frame).toString('base64')}`
    }
  } finally {
    previewHidden = false
    const shouldShow = restore || deferredShow
    deferredShow = false
    if (shouldShow && !shuttingDown) showWindow()
    state.busy = false
    publish()
  }
}

async function history(): Promise<CaptureHistory> {
  const listings = await Promise.all(captureRoots.map((root) => listCaptures(root)))
  const unique = new Map<string, CaptureHistory['events'][number]>()
  for (const listing of listings) {
    for (const event of listing.events)
      if (!unique.has(event.eventId)) unique.set(event.eventId, event)
  }
  const events = [...unique.values()].sort(
    (a, b) =>
      Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || b.eventId.localeCompare(a.eventId)
  )
  return {
    events: events.slice(0, 100),
    skippedEntries: listings.reduce((total, item) => total + item.skippedEntries, 0),
    hasMore: events.length > 100 || listings.some((item) => item.hasMore)
  }
}

async function eventRoot(eventId: unknown): Promise<string> {
  if (typeof eventId !== 'string') throw new Error('A capture event ID is required.')
  for (const root of captureRoots) {
    try {
      await resolveCaptureFolder(root, eventId)
      return root
    } catch {
      // An older portable version saved to .dev-captures; preserve access to those events.
    }
  }
  throw new Error('Capture event is invalid or no longer available.')
}

async function openFolder(eventId?: unknown): Promise<void> {
  let folder = captureRoot
  if (eventId !== undefined) {
    const root = await eventRoot(eventId)
    folder = await resolveCaptureFolder(root, eventId as string)
  } else {
    await mkdir(captureRoot, { recursive: true })
    folder = await resolveCaptureFolder(captureRoot)
  }
  const error = await shell.openPath(folder)
  if (error) throw new Error(error)
}

function assertTrustedSender(event: IpcMainInvokeEvent, args: unknown[], argumentCount = 0): void {
  if (
    shuttingDown ||
    args.length !== argumentCount ||
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame?.url !== documentUrl
  )
    throw new Error('Untrusted or unavailable IPC request')
}

function installIpc(): void {
  ipcMain.handle(IPC.getState, (event, ...args) => {
    assertTrustedSender(event, args)
    return state
  })
  ipcMain.handle(IPC.captureNow, (event, ...args) => {
    assertTrustedSender(event, args)
    return track(capture('button'))
  })
  ipcMain.handle(IPC.updateProfiles, (event, ...args) => {
    assertTrustedSender(event, args, 1)
    return track(
      (async () => {
        if (!profileStore || state.settingsError)
          throw new Error(state.settingsError || 'Profiles are not available.')
        try {
          state.settings = await profileStore.apply(args[0])
        } catch (error) {
          if (error instanceof ProfileFileConflictError) {
            state.settingsError = error.message
            publish()
          }
          logger.write('settings.save-failed', { error: String(error) })
          throw error
        }
        state.error = null
        publish()
        return state
      })()
    )
  })
  ipcMain.handle(IPC.previewScreen, (event, ...args) => {
    assertTrustedSender(event, args)
    return track(previewScreen())
  })
  ipcMain.handle(IPC.listCaptures, (event, ...args) => {
    assertTrustedSender(event, args)
    return track(history())
  })
  ipcMain.handle(IPC.readCaptureImage, (event, ...args) => {
    assertTrustedSender(event, args, 2)
    if (args[1] !== null && (!Number.isSafeInteger(args[1]) || (args[1] as number) < 1)) {
      throw new Error('A positive ROI ID or null for the original is required.')
    }
    return track(
      (async () =>
        readCaptureImage(await eventRoot(args[0]), args[0] as string, args[1] as number | null))()
    )
  })
  ipcMain.handle(IPC.openCaptureFolder, (event, ...args) => {
    assertTrustedSender(event, args, 1)
    return track(openFolder(args[0]))
  })
  ipcMain.handle(IPC.minimizeToTray, (event, ...args) => {
    assertTrustedSender(event, args)
    if (!state.backgroundAvailable) throw new Error('Background tray is not available.')
    window?.hide()
  })
  ipcMain.handle(IPC.quit, (event, ...args) => {
    assertTrustedSender(event, args)
    setImmediate(() => app.quit())
  })
}

function installTray(): void {
  if (process.platform !== 'win32') return
  try {
    tray = new Tray(applicationIconPath())
    tray.setToolTip('DFragonCropper')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open DFragonCropper', click: showWindow },
        {
          label: 'Open capture folder',
          click: () =>
            void openFolder().catch((error) => {
              state.error = String(error)
              showWindow()
              publish()
            })
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
    tray.on('double-click', showWindow)
    state.backgroundAvailable = true
  } catch (error) {
    logger.write('tray.failed', { error: String(error) })
    state.backgroundAvailable = false
  }
}

app
  .whenReady()
  .then(async () => {
    logger.write('app.started', { version: app.getVersion(), platform: process.platform })
    try {
      profileStore = await loadProfileStore(configPath())
      state.settings = profileStore.get()
    } catch (error) {
      state.settingsError = error instanceof Error ? error.message : String(error)
      logger.write('settings.load-failed', { error: state.settingsError })
    }
    const workArea = screen.getPrimaryDisplay().workAreaSize
    window = new BrowserWindow({
      width: Math.min(1120, workArea.width),
      height: Math.min(860, workArea.height),
      minWidth: Math.min(720, workArea.width),
      minHeight: Math.min(600, workArea.height),
      show: false,
      autoHideMenuBar: true,
      icon: applicationIconPath(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.on('close', (event) => {
      if (shuttingDown) return
      event.preventDefault()
      if (state.backgroundAvailable && state.settings?.preferences.closeToTray) {
        window?.hide()
      } else app.quit()
    })
    window.on('closed', () => {
      window = null
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    )
    window.webContents.session.setPermissionCheckHandler(() => false)
    installIpc()
    installTray()
    if (state.mode === 'keyboard-hook') {
      try {
        const listener = startPrintScreenListener(() => void track(capture('printscreen')))
        stopPrintScreen = () => listener.stop()
        state.triggerStatus =
          'PrintScreen listener active. Capture continues while the app is in the tray.'
      } catch (error) {
        state.triggerStatus = 'PrintScreen listener failed. Capture Now remains available.'
        state.error = error instanceof Error ? error.message : String(error)
      }
    } else if (state.mode === 'global-shortcut') {
      const registered = globalShortcut.register(
        'PrintScreen',
        () => void track(capture('printscreen'))
      )
      state.triggerStatus = registered
        ? 'Electron globalShortcut registered. Default PrintScreen behavior requires the Windows probe.'
        : 'PrintScreen registration failed. Capture Now remains available.'
    } else if (!fixture) state.triggerStatus = 'Windows 10 is required for native capture.'
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (development && devUrl) {
      documentUrl = new URL(devUrl).href
      await window.loadURL(documentUrl)
    } else {
      documentUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href
      await window.loadFile(fileURLToPath(documentUrl))
    }
    showWindow()
    publish()
  })
  .catch((error: unknown) => {
    logger.write('app.start-failed', { error: String(error) })
    dialog.showErrorBox('DFragonCropper could not start', String(error))
    app.quit()
  })

app.on('before-quit', (event) => {
  if (allowQuit) return
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  // Finish the current PNG/config write before closing; new requests are now rejected.
  void Promise.allSettled([...operations]).then(async () => {
    logger.write('app.stopped')
    await logger.flush()
    allowQuit = true
    app.quit()
  })
})
app.on('will-quit', () => {
  try {
    stopPrintScreen()
  } catch (error) {
    console.error('PrintScreen cleanup failed:', error)
  }
  globalShortcut.unregisterAll()
  tray?.destroy()
})
app.on('window-all-closed', () => app.quit())
