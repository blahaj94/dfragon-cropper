import { app, dialog, shell, type Tray } from 'electron'
import { writeFileSync } from 'node:fs'
import { IPC, type SpikeState } from '../shared/contracts'
import { defaultShortcuts } from '../shared/shortcuts'
import { applicationIconPath } from './app-icon'
import { capturePrimaryFrame } from './capture'
import { createCaptureController } from './capture/controller'
import { createFixtureSource } from './capture/fixture'
import { createCaptureLibrary } from './capture/library'
import { startCaptureShortcuts } from './capture-shortcuts'
import { installMainIpc } from './ipc'
import { createGroundTruthLibrary } from './ground-truth'
import { createLogger } from './logging'
import { MainWindow } from './main-window'
import { PendingOperations } from './operations'
import { createProfileController } from './profiles/controller'
import { RoiSelectionWindow } from './roi-selection'
import { createRoiSelectionController } from './roi-selection-controller'
import { resolveRuntime } from './runtime'
import { createAppTray } from './tray'

app.setName('DFragonCropper')
const runtime = resolveRuntime({
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
  bundleDirectory: __dirname,
  execPath: process.execPath,
  platform: process.platform,
  environment: process.env
})
if (runtime.userData) app.setPath('userData', runtime.userData)
// Prevent duplicate PrintScreen listeners and concurrent config writers for normal launches.
if (!app.requestSingleInstanceLock()) app.exit(0)

const logger = createLogger(runtime.logDirectory)
const operations = new PendingOperations()
let mainWindow: MainWindow | undefined
let selectionWindow: RoiSelectionWindow | undefined
let tray: Tray | undefined
let shortcuts: ReturnType<typeof startCaptureShortcuts> | undefined
let shuttingDown = false
let allowQuit = false
const state: SpikeState = {
  platform: runtime.platform,
  mode: runtime.mode,
  triggerStatus: runtime.fixture
    ? 'Synthetic fixture; Windows capture is not exercised.'
    : 'Starting…',
  selectionShortcutStatus: 'F12 selects an ROI while the app is focused.',
  busy: false,
  completed: 0,
  failed: 0,
  skipped: 0,
  lastCapture: null,
  error: null,
  settings: null,
  settingsError: null,
  outputDirectory: runtime.captureRoot,
  backgroundAvailable: false
}

const showWindow = () => mainWindow?.show()
const isShuttingDown = () => shuttingDown
const publish = () => {
  const window = mainWindow?.window
  if (window && !window.isDestroyed()) window.webContents.send(IPC.state, state)
  tray?.setToolTip(
    'DFragonCropper · ' + state.completed + ' captured' + (state.error ? ' · Capture error' : '')
  )
  if (runtime.stateFile) writeFileSync(runtime.stateFile, JSON.stringify(state, null, 2))
}
const captureFrame = runtime.fixture ? createFixtureSource(runtime.fixture) : capturePrimaryFrame
const capture = createCaptureController({
  state,
  outputRoot: runtime.captureRoot,
  captureFrame,
  logger,
  publish,
  isShuttingDown
})
const selection = createRoiSelectionController({
  state,
  captureFrame,
  fixture: !!runtime.fixture,
  mainWindow: () => mainWindow,
  selectionWindow: () => selectionWindow,
  logger,
  publish,
  isShuttingDown
})
const profiles = createProfileController({
  state,
  configPath: runtime.configPath,
  logger,
  publish,
  selectionActive: selection.isActive,
  onSaved: () => shortcuts?.refresh()
})
const library = createCaptureLibrary(runtime.captureRoots)
const groundTruth = createGroundTruthLibrary(runtime.captureRoots)
const openCaptureFolder = async (eventId?: unknown) => {
  const error = await shell.openPath(await library.resolveFolder(eventId))
  if (error) throw new Error(error)
}
const requestRoiSelection = () => {
  const window = mainWindow?.window
  if (selection.canRequest() && window && !window.isDestroyed())
    window.webContents.send(IPC.selectRoiRequested)
}

function installDesktop(): void {
  const icon = applicationIconPath()
  mainWindow = new MainWindow({
    preload: runtime.preload,
    icon,
    isShuttingDown,
    closeToTray: () => !!(state.backgroundAvailable && state.settings?.preferences.closeToTray),
    nativeSelectionShortcut: () => shortcuts?.nativeSelection ?? false,
    focusedCaptureAvailable: () => state.mode !== 'global-shortcut',
    getShortcuts: () => state.settings?.shortcuts ?? defaultShortcuts(),
    requestCapture: (key) =>
      void operations.track(capture(key === 0x2c ? 'printscreen' : 'shortcut')),
    requestSelection: requestRoiSelection,
    onUnavailable: () => selectionWindow?.cancel(),
    quit: () => app.quit()
  })
  selectionWindow = new RoiSelectionWindow({
    documentUrl: () => runtime.documentUrl,
    preload: runtime.preload,
    icon
  })
  if (runtime.platform !== 'win32') return
  try {
    tray = createAppTray({
      icon,
      showWindow,
      openCaptureFolder,
      onFolderError: (error) => {
        state.error = String(error)
        showWindow()
        publish()
      },
      quit: () => app.quit()
    })
    state.backgroundAvailable = true
  } catch (error) {
    logger.write('tray.failed', { error: String(error) })
    state.backgroundAvailable = false
  }
}

function connectIpc(): void {
  installMainIpc({
    window: () => mainWindow?.window,
    documentUrl: runtime.documentUrl,
    isShuttingDown,
    operations,
    actions: {
      getState: async () => state,
      captureNow: () => capture('button'),
      updateProfiles: profiles.update,
      selectRoi: selection.select,
      listCaptures: library.list,
      readCaptureImage: library.readImage,
      listGroundTruthCaptures: groundTruth.list,
      readGroundTruthCapture: groundTruth.read,
      readGroundTruthImage: groundTruth.readImage,
      saveGroundTruth: groundTruth.save,
      openCaptureFolder,
      minimizeToTray: async () => {
        if (!state.backgroundAvailable) throw new Error('Background tray is not available.')
        mainWindow?.window.hide()
      },
      quit: async () => {
        setImmediate(() => app.quit())
      }
    }
  })
}

app.on('second-instance', showWindow)
app.on('activate', showWindow)
app
  .whenReady()
  .then(async () => {
    logger.write('app.started', { version: app.getVersion(), platform: runtime.platform })
    await profiles.load()
    installDesktop()
    connectIpc()
    shortcuts = startCaptureShortcuts({
      state,
      capture: (trigger) => void operations.track(capture(trigger)),
      selectRoi: requestRoiSelection
    })
    await mainWindow!.window.loadURL(runtime.documentUrl)
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
  // Settle pending user input before draining writes so an open overlay cannot block Quit.
  selectionWindow?.cancel()
  void operations.drain().then(async () => {
    logger.write('app.stopped')
    await logger.flush()
    allowQuit = true
    app.quit()
  })
})
app.on('will-quit', () => {
  try {
    shortcuts?.stop()
  } catch (error) {
    console.error('PrintScreen cleanup failed:', error)
  }
  tray?.destroy()
})
app.on('window-all-closed', () => app.quit())
