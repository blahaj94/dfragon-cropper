import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join, dirname } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { captureAndSave, type Frame, type CaptureTrigger } from './capture'
import { IPC, type SpikeState } from '../shared/contracts'
import { startPrintScreenListener } from './printscreen'
import { loadProfileStore, ProfileFileConflictError, type ProfileStore } from './profiles'

app.setName('DFragonCropper')
const development = !app.isPackaged
const fixture = development ? process.env.DFRAGON_FIXTURE : undefined
if (development && process.env.DFRAGON_USER_DATA) {
  app.setPath('userData', process.env.DFRAGON_USER_DATA)
}

let window: BrowserWindow | null = null
let documentUrl = ''
let stopPrintScreen = () => {}
let profileStore: ProfileStore | null = null
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
  settingsError: null
}

// For a portable self-extracting EXE, process.execPath points inside the temporary extraction.
function outputRoot(): string {
  if (development) return process.env.DFRAGON_OUTPUT_DIR || join(app.getAppPath(), '.dev-captures')
  return join(process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath), '.dev-captures')
}

function configPath(): string {
  if (development) {
    return process.env.DFRAGON_CONFIG_FILE || join(app.getAppPath(), '.dev-config', 'config.json')
  }
  return join(process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath), 'config.json')
}

function publish(): void {
  window?.webContents.send(IPC.state, state)
  // Development harness telemetry; no arbitrary renderer filesystem API is exposed.
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
      const offset = (y * width + x) * 4
      rgba.set([x % 256, y % 256, (x + y) % 256, 255], offset)
    }
  }
  return { width, height, rgba, capturedAt: new Date().toISOString(), backend: 'fixture' }
}

async function capture(trigger: CaptureTrigger): Promise<SpikeState> {
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
      outputRoot: outputRoot(),
      trigger,
      profile: { id: activeProfile.id, name: activeProfile.name },
      regions: activeProfile.regions,
      ...(fixture ? { captureFrame: fixtureFrame } : {})
    })
    state.completed++
  } catch (error) {
    state.failed++
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.busy = false
    publish()
  }
  return state
}

function assertTrustedSender(event: IpcMainInvokeEvent, args: unknown[], argumentCount = 0): void {
  if (
    args.length !== argumentCount ||
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame?.url !== documentUrl
  ) {
    throw new Error('Untrusted IPC request')
  }
}

app.whenReady().then(async () => {
  try {
    profileStore = await loadProfileStore(configPath())
    state.settings = profileStore.get()
  } catch (error) {
    state.settingsError = error instanceof Error ? error.message : String(error)
  }
  window = new BrowserWindow({
    width: 1040,
    height: 800,
    minWidth: 720,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  window.webContents.session.setPermissionCheckHandler(() => false)

  ipcMain.handle(IPC.getState, (event, ...args) => {
    assertTrustedSender(event, args)
    return state
  })
  ipcMain.handle(IPC.captureNow, (event, ...args) => {
    assertTrustedSender(event, args)
    return capture('button')
  })
  ipcMain.handle(IPC.updateProfiles, async (event, ...args) => {
    assertTrustedSender(event, args, 1)
    if (!profileStore) throw new Error(state.settingsError || 'Profiles are not available.')
    if (state.settingsError) throw new Error(state.settingsError)
    try {
      state.settings = await profileStore.apply(args[0])
    } catch (error) {
      if (error instanceof ProfileFileConflictError) {
        state.settingsError = error.message
        publish()
      }
      throw error
    }
    state.error = null
    publish()
    return state
  })

  if (state.mode === 'keyboard-hook') {
    try {
      const listener = startPrintScreenListener(() => void capture('printscreen'))
      stopPrintScreen = () => listener.stop()
      state.triggerStatus = 'PrintScreen listener active (Win32 pass-through hook).'
    } catch (error) {
      state.triggerStatus = 'PrintScreen listener failed. Capture Now remains available.'
      state.error = error instanceof Error ? error.message : String(error)
    }
  } else if (state.mode === 'global-shortcut') {
    const registered = globalShortcut.register('PrintScreen', () => {
      void capture('printscreen')
    })
    state.triggerStatus = registered
      ? 'Electron globalShortcut registered. Default PrintScreen behavior requires the Windows probe.'
      : 'PrintScreen registration failed. Capture Now remains available.'
  } else if (!fixture) {
    state.triggerStatus = 'Windows 10 is required for native capture.'
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (development && devUrl) {
    documentUrl = new URL(devUrl).href
    await window.loadURL(documentUrl)
  } else {
    const html = join(__dirname, '../renderer/index.html')
    // Resolve using URL to match Chromium's encoded file URL in IPC validation.
    const { pathToFileURL } = await import('node:url')
    documentUrl = pathToFileURL(html).href
    await window.loadFile(fileURLToPath(documentUrl))
  }
  window.show()
  publish()
})

app.on('will-quit', () => {
  try {
    stopPrintScreen()
  } catch (error) {
    console.error('PrintScreen cleanup failed:', error)
  } finally {
    globalShortcut.unregisterAll()
  }
})
app.on('window-all-closed', () => app.quit())
