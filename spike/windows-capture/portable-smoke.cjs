/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS harness launches the built portable EXE. */
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { basename, dirname, join, resolve } = require('node:path')
const { chromium } = require('@playwright/test')
const { PNG } = require('pngjs')

const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const executableArgument = argument('--executable-path')
const outputArgument = argument('--output')
if (process.platform !== 'win32' || !executableArgument || !outputArgument) {
  throw new Error('Run on Windows with --executable-path <portable EXE> --output <JSON>.')
}
const verifyLocalMvp = process.argv.includes('--verify-local-mvp')
const coordinatesOnly = verifyLocalMvp && process.argv.includes('--coordinates-only')
const verifyProfiles = verifyLocalMvp || process.argv.includes('--verify-profiles')
const expectedScale = Number(argument('--scale'))
if (verifyLocalMvp) assert([1, 1.5].includes(expectedScale), 'MVP mode requires --scale 1 or 1.5')
const executable = resolve(executableArgument)
const output = resolve(outputArgument)
const pause = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds))
const alive = (pid) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const result = {
  schemaVersion: 1,
  experiment: verifyLocalMvp
    ? 'portable-local-MVP-real-Windows-frames'
    : verifyProfiles
      ? 'portable-profile-editor-native-capture'
      : 'portable-EXE-native-button-capture',
  transport: 'normal NSIS portable launch; Playwright over loopback CDP',
  injection:
    verifyLocalMvp && !coordinatesOnly
      ? 'one synthetic keybd_event PrintScreen; physical keyboard unverified; real native frames'
      : 'none; Capture Now button only',
  executable: basename(executable),
  ...(verifyLocalMvp
    ? { verificationScope: coordinatesOnly ? 'coordinates-only' : 'local-MVP' }
    : {}),
  startedAt: new Date().toISOString(),
  completed: false
}
let profile
let launcher
let browser
let page
let applicationPid
let fixture
let fixtureProfile
let fixtureState
let fixtureWindow
let secondLauncher
let ownedWindow
let native

async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const port = server.address().port
  await new Promise((accept) => server.close(accept))
  return port
}

function cleanEnvironment() {
  const environment = { ...process.env }
  for (const name of [
    'DFRAGON_CONFIG_FILE',
    'DFRAGON_FIXTURE',
    'DFRAGON_TRIGGER',
    'DFRAGON_OUTPUT_DIR',
    'DFRAGON_USER_DATA',
    'DFRAGON_STATE_FILE',
    'ELECTRON_RENDERER_URL',
    'ELECTRON_RUN_AS_NODE',
    'PORTABLE_EXECUTABLE_DIR'
  ]) {
    delete environment[name]
  }
  return environment
}

async function launchPortable() {
  const port = await freePort()
  const endpoint = `http://127.0.0.1:${port}`
  launcher = spawn(
    executable,
    [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`
    ],
    { cwd: dirname(executable), env: cleanEnvironment(), stdio: 'ignore' }
  )
  let launchError
  launcher.once('error', (error) => (launchError = error))
  const deadline = Date.now() + 20_000
  let ready = false
  while (Date.now() < deadline) {
    if (launchError) throw launchError
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) })
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // The portable wrapper must first extract and launch its child Electron process.
    }
    await pause(100)
  }
  assert(ready, 'Portable Electron did not expose its loopback CDP endpoint before the deadline')
  browser = await chromium.connectOverCDP(endpoint, { timeout: 5_000 })
  const session = await browser.newBrowserCDPSession()
  const processes = await session.send('SystemInfo.getProcessInfo')
  applicationPid = processes.processInfo.find((entry) => entry.type === 'browser')?.id
  assert(applicationPid, 'Could not identify the owned Electron process for cleanup')
  const pages = browser.contexts().flatMap((context) => context.pages())
  page = pages[0]
  assert(page, 'Portable app did not create a renderer window')
  page.setDefaultTimeout(8_000)
  await page.waitForFunction(() => typeof window.spike?.getState === 'function', null, {
    timeout: 5_000
  })
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      methods: Object.keys(window.spike).sort()
    })),
    {
      require: 'undefined',
      process: 'undefined',
      methods: [
        'captureNow',
        'getState',
        'listCaptures',
        'minimizeToTray',
        'onState',
        'openCaptureFolder',
        'previewScreen',
        'quit',
        'readCaptureImage',
        'updateProfiles'
      ].sort()
    }
  )
  result.rendererBoundaryVerified = true
}

async function closeForRestart() {
  // Closing a window may now keep the app alive in the tray. Quit through its named API.
  await page
    .evaluate(() => {
      void window.spike.quit()
    })
    .catch(() => {})
  await browser.close().catch(() => {})
  const deadline = Date.now() + 5_000
  while ((alive(applicationPid) || alive(launcher?.pid)) && Date.now() < deadline) await pause(100)
  assert(!alive(applicationPid) && !alive(launcher?.pid), 'Portable app did not exit cleanly')
  page = undefined
  browser = undefined
  launcher = undefined
  applicationPid = undefined
  ownedWindow = undefined
}

async function waitState(accept, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  do {
    const state = await page.evaluate(() => window.spike.getState())
    if (accept(state)) return state
    await pause(50)
  } while (Date.now() < deadline)
  throw new Error(`${label} did not complete before its deadline`)
}

function nativeApi() {
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const api = {
    foreground: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
    process: user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t, _Out_ uint32_t *)'
    ),
    setDpi: user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t)'),
    metrics: user32.func('int __stdcall GetSystemMetrics(int)'),
    dpi: user32.func('uint32_t __stdcall GetDpiForWindow(uintptr_t)'),
    visible: user32.func('int __stdcall IsWindowVisible(uintptr_t)'),
    postMessage: user32.func(
      'int __stdcall PostMessageW(uintptr_t, uint32_t, uintptr_t, intptr_t)'
    ),
    allowForeground: user32.func('int __stdcall AllowSetForegroundWindow(uint32_t)'),
    key: user32.func('void __stdcall keybd_event(uint8_t, uint8_t, uint32_t, uintptr_t)'),
    clipboardSequence: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()')
  }
  api.owner = (window) => {
    const pid = [0]
    api.process(window, pid)
    return pid[0]
  }
  return api
}

async function verifyPreviewAndDrawing() {
  native = nativeApi()
  await page.bringToFront()
  const deadline = Date.now() + 5_000
  while (native.owner(native.foreground()) !== applicationPid && Date.now() < deadline)
    await pause(50)
  ownedWindow = native.foreground()
  assert.equal(
    native.owner(ownedWindow),
    applicationPid,
    'Foreground HWND is not the owned portable app'
  )
  const previousDpi = native.setDpi(-3)
  assert(previousDpi, 'Could not enter physical-pixel DPI context')
  let physical
  try {
    physical = { width: native.metrics(0), height: native.metrics(1) }
  } finally {
    native.setDpi(previousDpi)
  }
  const windowDpi = native.dpi(ownedWindow)
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio)
  assert.equal(
    windowDpi / 96,
    expectedScale,
    'Actual app window DPI differs from requested Windows scale'
  )
  assert.equal(devicePixelRatio, expectedScale, 'Renderer scale differs from actual Windows scale')
  const refreshClick = page
    .getByRole('button', { name: 'Refresh screen preview', exact: true })
    .click()
  const hideDeadline = Date.now() + 5_000
  let hiddenDuringPreview = false
  while (Date.now() < hideDeadline) {
    if (!native.visible(ownedWindow)) {
      hiddenDuringPreview = true
      break
    }
    await pause(10)
  }
  await refreshClick
  assert(hiddenDuringPreview, 'The app did not hide while taking the real screen preview')
  const image = page.getByTestId('screen-preview')
  await image.waitFor()
  await image.evaluate((element) => element.decode())
  const imageData = await image.evaluate((element) => ({
    width: element.naturalWidth,
    height: element.naturalHeight,
    src: element.src
  }))
  assert.deepEqual({ width: imageData.width, height: imageData.height }, physical)
  const preview = PNG.sync.read(Buffer.from(imageData.src.split(',')[1], 'base64'))
  assert.deepEqual({ width: preview.width, height: preview.height }, physical)
  assert.equal(
    (await page.evaluate(() => window.spike.getState())).completed,
    0,
    'Preview saved an unintended capture event'
  )
  await image.scrollIntoViewIfNeeded()
  const box = await image.boundingBox()
  assert(box && box.width > 0 && box.height > 0, 'Preview has no visible drawing bounds')
  await page.evaluate(() => {
    window.__portablePointerSamples = []
    for (const type of ['pointerdown', 'pointerup']) {
      window.addEventListener(
        type,
        (event) => {
          const image = document.querySelector('[data-testid="screen-preview"]')
          const rect = image.getBoundingClientRect()
          window.__portablePointerSamples.push({
            type,
            x: event.clientX,
            y: event.clientY,
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight
          })
        },
        { capture: true, once: true }
      )
    }
  })
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
  await page.mouse.down()
  try {
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 5 })
  } finally {
    await page.mouse.up()
  }
  const samples = await page.evaluate(() => {
    const samples = window.__portablePointerSamples
    delete window.__portablePointerSamples
    return samples
  })
  assert.deepEqual(
    samples.map((sample) => sample.type),
    ['pointerdown', 'pointerup']
  )
  const [start, end] = samples
  assert.deepEqual(start.bounds, end.bounds, 'Preview moved during the drag')
  const bounds = start.bounds
  const left = Math.floor(
    ((Math.min(start.x, end.x) - bounds.x) * start.naturalWidth) / bounds.width
  )
  const top = Math.floor(
    ((Math.min(start.y, end.y) - bounds.y) * start.naturalHeight) / bounds.height
  )
  const right = Math.ceil(
    ((Math.max(start.x, end.x) - bounds.x) * start.naturalWidth) / bounds.width
  )
  const bottom = Math.ceil(
    ((Math.max(start.y, end.y) - bounds.y) * start.naturalHeight) / bounds.height
  )
  const rectangle = { id: 3, x: left, y: top, width: right - left, height: bottom - top }
  await page.getByRole('button', { name: 'Add drawn ROI', exact: true }).click()
  const saved = await waitState(
    (state) => state.settings.profiles.find((entry) => entry.id === 2)?.regions.length === 3,
    'Drawn ROI save'
  )
  assert.deepEqual(saved.settings.profiles.find((entry) => entry.id === 2).regions[2], rectangle)
  result.profiles.regions = saved.settings.profiles.find((entry) => entry.id === 2).regions
  result.previewAndDrawing = {
    expectedScale,
    windowDpi,
    devicePixelRatio,
    physicalSize: physical,
    previewDimensionsExact: true,
    hiddenDuringPreview,
    pointerCoordinates: samples,
    savedRectangle: rectangle,
    independentFloorCeilComparison: true,
    previewCreatedNoCaptureEvent: true
  }
}

async function verifyBackgroundAndHistory() {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Save original PNG', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  const configured = await waitState(
    (state) => state.settings.preferences.saveOriginal === false,
    'Original-file setting save'
  )
  assert.equal(configured.settings.preferences.closeToTray, true)
  assert.equal(configured.backgroundAvailable, true, 'Tray setup did not succeed')
  assert.equal(
    native.owner(ownedWindow),
    applicationPid,
    'Cached HWND no longer belongs to the owned app'
  )
  assert(
    native.postMessage(ownedWindow, 0x0010, 0, 0),
    'WM_CLOSE could not be posted to the owned window'
  )
  const hideDeadline = Date.now() + 5_000
  while (native.visible(ownedWindow) && Date.now() < hideDeadline) await pause(50)
  assert.equal(
    !!native.visible(ownedWindow),
    false,
    'Window close did not hide the app to its tray'
  )
  assert(alive(applicationPid), 'Closing to tray terminated the app')
  const hiddenState = await page.evaluate(() => window.spike.getState())
  assert.equal(hiddenState.backgroundAvailable, true)
  assert.equal(hiddenState.completed, 1)

  fixtureState = join(dirname(output), `portable-focus-${Date.now()}.json`)
  fixture = spawn(
    require('electron'),
    [
      join(__dirname, 'global-shortcut-probe.cjs'),
      '--focus-fixture',
      '--fixture-state',
      fixtureState,
      '--fixture-lifetime-ms',
      '60000'
    ],
    { env: cleanEnvironment(), stdio: 'ignore' }
  )
  let fixtureError
  fixture.once('error', (error) => {
    fixtureError = error
  })
  assert(fixture.pid, 'Separate foreground fixture did not start')
  fixtureProfile = join(dirname(fixtureState), `profile-${fixture.pid}`)
  native.allowForeground(fixture.pid)
  const focusDeadline = Date.now() + 8_000
  while (Date.now() < focusDeadline) {
    if (fixtureError) throw fixtureError
    let ready = false
    try {
      ready = JSON.parse(await readFile(fixtureState, 'utf8')).pid === fixture.pid
    } catch {
      /* still loading */
    }
    if (ready && native.owner(native.foreground()) === fixture.pid) break
    await pause(50)
  }
  assert.equal(
    native.owner(native.foreground()),
    fixture.pid,
    'Separate fixture did not acquire foreground; no key injected'
  )
  fixtureWindow = native.foreground()
  assert.notEqual(fixture.pid, applicationPid)
  const clipboardBefore = native.clipboardSequence()
  native.key(0x2c, 0x37, 0x0001, 0)
  try {
    await pause(40)
  } finally {
    native.key(0x2c, 0x37, 0x0001 | 0x0002, 0)
  }
  const state = await waitState(
    (current) => !current.busy && (current.completed >= 2 || current.failed > 0),
    'Background PrintScreen capture'
  )
  assert.equal(state.completed, 2, 'One synthetic key produced an unexpected capture count')
  assert.equal(state.failed, 0, state.error || 'Background capture failed')
  assert.equal(state.skipped, 0)
  assert.equal(state.lastCapture.trigger, 'printscreen')
  assert.equal(state.lastCapture.originalSaved, false)
  const clipboardDeadline = Date.now() + 2_000
  while (native.clipboardSequence() === clipboardBefore && Date.now() < clipboardDeadline)
    await pause(25)
  assert.notEqual(
    native.clipboardSequence(),
    clipboardBefore,
    'Windows default clipboard action did not occur'
  )
  assert.equal(
    native.owner(native.foreground()),
    fixture.pid,
    'Background capture stole foreground'
  )
  assert.equal(
    !!native.visible(ownedWindow),
    false,
    'Background capture reopened the product window'
  )
  const last = state.lastCapture
  const metadata = JSON.parse(await readFile(join(last.outputDirectory, 'metadata.json'), 'utf8'))
  assert.equal(metadata.source.backend, 'win32-gdi')
  assert.equal(metadata.source.file, null)
  assert.equal(metadata.eventId, last.eventId)
  assert.deepEqual(metadata.profile, { id: 2, name: 'Windows saved profile' })
  assert.deepEqual(
    metadata.regions.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    result.profiles.regions
  )
  await assert.rejects(stat(join(last.outputDirectory, 'original.png')), { code: 'ENOENT' })
  assert.equal(
    (await readdir(last.outputDirectory)).filter((name) => name.endsWith('.png')).length,
    3
  )
  for (const region of metadata.regions) {
    const png = PNG.sync.read(await readFile(join(last.outputDirectory, region.file)))
    assert.deepEqual(
      { width: png.width, height: png.height },
      { width: region.width, height: region.height }
    )
  }
  result.backgroundCapture = {
    realFrame: true,
    syntheticPrintScreenPresses: 1,
    closedWindowRemainedHidden: true,
    productRemainedBackground: true,
    clipboardSequenceChanged: true,
    completed: 2,
    failed: 0,
    skipped: 0,
    originalSaved: false,
    roiPngCount: 3
  }

  // The existing instance must be restored, with no second listener or capture event.
  const existingPid = applicationPid
  secondLauncher = spawn(executable, [`--user-data-dir=${profile}`], {
    cwd: dirname(executable),
    env: cleanEnvironment(),
    stdio: 'ignore'
  })
  let secondError
  secondLauncher.once('error', (error) => {
    secondError = error
  })
  assert(secondLauncher.pid, 'Second portable launcher did not start')
  const secondDeadline = Date.now() + 20_000
  while (Date.now() < secondDeadline) {
    if (secondError) throw secondError
    if (native.visible(ownedWindow) && secondLauncher.exitCode !== null) break
    await pause(50)
  }
  assert(native.visible(ownedWindow), 'Second launch did not restore the existing window')
  assert.equal(
    native.owner(ownedWindow),
    existingPid,
    'Second launch replaced the original app process'
  )
  assert(alive(existingPid), 'Original app process is no longer running')
  assert.notEqual(secondLauncher.exitCode, null, 'Second portable launcher did not exit')
  assert.equal(secondLauncher.exitCode, 0, 'Second portable launcher exited with an error')
  const restored = await page.evaluate(() => window.spike.getState())
  assert.equal(restored.completed, 2)
  assert.equal(restored.failed, 0)
  assert.equal(restored.skipped, 0)
  result.singleInstance = {
    existingProcessRetained: true,
    windowRestored: true,
    secondLauncherExited: true,
    captureCountUnchanged: true
  }

  const history = await page.evaluate(() => window.spike.listCaptures())
  assert.equal(history.events.length, 2)
  assert.equal(history.skippedEntries, 0)
  assert.equal(history.hasMore, false)
  assert.equal(history.events[0].eventId, last.eventId)
  assert.equal(history.events[0].originalSaved, false)
  assert.equal(history.events[1].originalSaved, true)
  const roi = history.events[0].regions[2]
  const dataUrl = await page.evaluate(
    ({ eventId, regionId }) => window.spike.readCaptureImage(eventId, regionId),
    { eventId: last.eventId, regionId: roi.id }
  )
  assert(dataUrl.startsWith('data:image/png;base64,'))
  const displayedBytes = Buffer.from(dataUrl.split(',')[1], 'base64')
  assert.deepEqual(
    displayedBytes,
    await readFile(roi.path),
    'History preview differs from the actual Windows PNG file'
  )
  const displayed = PNG.sync.read(displayedBytes)
  assert.deepEqual(
    { width: displayed.width, height: displayed.height },
    { width: roi.width, height: roi.height }
  )
  result.history = {
    events: 2,
    newestOriginalSaved: false,
    roiPreviewBytesMatchWindowsFile: true,
    roiPreviewDimensionsExact: true
  }
}

async function run() {
  await mkdir(dirname(output), { recursive: true })
  result.executableBytes = (await stat(executable)).size
  profile = await mkdtemp(join(dirname(output), 'portable-profile-'))
  if (verifyProfiles) {
    // This mode intentionally edits configuration; only use a fresh isolated EXE directory.
    await assert.rejects(stat(join(dirname(executable), 'config.json')), { code: 'ENOENT' })
    await assert.rejects(stat(join(dirname(executable), 'config.json.bak')), { code: 'ENOENT' })
  }
  await launchPortable()
  const initial = await page.evaluate(() => window.spike.getState())
  assert.equal(initial.platform, 'win32')
  assert.equal(initial.mode, 'keyboard-hook')
  assert.equal(initial.error, null)
  assert.equal(initial.completed, 0)
  assert.equal(initial.settingsError, null)
  assert.equal(initial.settings.schemaVersion, 2)
  assert.deepEqual(initial.settings.preferences, { saveOriginal: true, closeToTray: true })
  if (verifyProfiles) {
    await page
      .getByRole('textbox', { name: 'New profile name', exact: true })
      .fill('Windows saved profile')
    await page.getByRole('button', { name: 'Create profile', exact: true }).click()
    await page.getByTestId('active-profile').filter({ hasText: 'Windows saved profile' }).waitFor()
    const rectangles = [
      { x: 31, y: 37, width: 137, height: 83 },
      { x: 301, y: 121, width: 89, height: 71 }
    ]
    for (const rectangle of rectangles) {
      const group = page.getByRole('group', { name: 'New ROI', exact: true })
      for (const [field, value] of Object.entries(rectangle)) {
        await group
          .getByLabel(field[0].toUpperCase() + field.slice(1), { exact: true })
          .fill(String(value))
      }
      await group.getByRole('button', { name: 'Add ROI', exact: true }).click()
      // The next row must wait for the async disk save, not only the click dispatch.
      const expectedCount = rectangles.indexOf(rectangle) + 1
      const deadline = Date.now() + 5_000
      let count = 0
      do {
        const current = await page.evaluate(() => window.spike.getState())
        count = current.settings.profiles.find(
          (entry) => entry.id === current.settings.activeProfileId
        ).regions.length
        if (count === expectedCount) break
        await pause(50)
      } while (Date.now() < deadline)
      assert.equal(count, expectedCount)
    }
    const persisted = JSON.parse(await readFile(join(dirname(executable), 'config.json'), 'utf8'))
    assert.equal(persisted.activeProfileId, 2)
    assert.equal(persisted.profiles[1].name, 'Windows saved profile')
    assert.deepEqual(
      persisted.profiles[1].regions,
      rectangles.map((rectangle, index) => ({ id: index + 1, ...rectangle }))
    )
    const backup = JSON.parse(await readFile(join(dirname(executable), 'config.json.bak'), 'utf8'))
    assert.equal(backup.profiles[1].regions.length, 1)
    await closeForRestart()
    await launchPortable()
    const reloaded = await page.evaluate(() => window.spike.getState())
    assert.equal(reloaded.settingsError, null)
    assert.deepEqual(reloaded.settings, persisted)
    result.profiles = {
      editedViaRenderer: true,
      persistedBesidePortableExecutable: true,
      backupPreserved: true,
      restartPreservedSettings: true,
      activeProfileId: 2,
      regions: persisted.profiles[1].regions
    }
  }
  if (verifyLocalMvp) await verifyPreviewAndDrawing()
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  const captureDeadline = Date.now() + 10_000
  let state
  do {
    state = await page.evaluate(() => window.spike.getState())
    if (!state.busy && (state.completed > 0 || state.failed > 0)) break
    await pause(50)
  } while (Date.now() < captureDeadline)
  assert.equal(state.busy, false, 'Native capture did not complete before the deadline')
  assert.equal(state.failed, 0, state.error || 'Native capture failed')
  assert.equal(state.completed, 1)
  assert.equal(state.skipped, 0)
  const capture = state.lastCapture
  assert.equal(capture.trigger, 'button')
  assert.equal(
    dirname(resolve(capture.outputDirectory)).toLowerCase(),
    join(dirname(executable), 'captures').toLowerCase(),
    'Capture output did not use the outer portable EXE directory'
  )
  const metadata = JSON.parse(
    await readFile(join(capture.outputDirectory, 'metadata.json'), 'utf8')
  )
  assert.equal(metadata.eventId, capture.eventId)
  assert.equal(metadata.trigger, 'button')
  assert.notEqual(metadata.source.backend, 'fixture')
  const original = PNG.sync.read(
    await readFile(join(capture.outputDirectory, metadata.source.file))
  )
  assert.equal(original.width, capture.width)
  assert.equal(original.height, capture.height)
  for (const region of metadata.regions) {
    const png = PNG.sync.read(await readFile(join(capture.outputDirectory, region.file)))
    assert.equal(png.width, region.width)
    assert.equal(png.height, region.height)
    for (let y = 0; y < region.height; y++) {
      const sourceOffset = ((region.y + y) * original.width + region.x) * 4
      assert.deepEqual(
        png.data.subarray(y * region.width * 4, (y + 1) * region.width * 4),
        original.data.subarray(sourceOffset, sourceOffset + region.width * 4)
      )
    }
  }
  if (verifyProfiles) {
    assert.deepEqual(metadata.profile, { id: 2, name: 'Windows saved profile' })
    assert.deepEqual(capture.profile, metadata.profile)
    assert.deepEqual(
      metadata.regions.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
      result.profiles.regions
    )
    result.profiles.exactSourceCropBytes = true
  }
  result.capture = {
    completed: state.completed,
    failed: state.failed,
    skipped: state.skipped,
    width: capture.width,
    height: capture.height,
    backend: metadata.source.backend,
    savedPngCount: metadata.regions.length + 1,
    outputBesidePortableExecutable: true
  }
  if (verifyLocalMvp && !coordinatesOnly) await verifyBackgroundAndHistory()
  result.completed = true
}

async function main() {
  try {
    await run()
  } catch (error) {
    let message = String(error instanceof Error ? error.message : error)
    for (const path of [profile, fixtureProfile, dirname(executable), dirname(output)]) {
      if (path) message = message.replaceAll(path, '<private-path>')
    }
    result.error = message
  } finally {
    let clean = true
    if (page && !page.isClosed()) {
      await page
        .evaluate(() => {
          void window.spike.quit()
        })
        .catch(() => {})
    }
    if (native && fixtureWindow && native.owner(fixtureWindow) === fixture?.pid) {
      native.postMessage(fixtureWindow, 0x0010, 0, 0)
    }
    if (browser) await browser.close().catch(() => {})
    const deadline = Date.now() + 3_000
    while (
      (alive(applicationPid) ||
        alive(launcher?.pid) ||
        alive(fixture?.pid) ||
        alive(secondLauncher?.pid)) &&
      Date.now() < deadline
    )
      await pause(100)
    for (const pid of new Set([applicationPid, launcher?.pid, fixture?.pid, secondLauncher?.pid])) {
      if (!alive(pid)) continue
      result.forcedProcessCleanup = true
      await new Promise((accept) => {
        const kill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
        kill.once('exit', accept)
        kill.once('error', accept)
      })
      if (alive(pid)) clean = false
    }
    for (const temporaryProfile of [profile, fixtureProfile]) {
      if (!temporaryProfile) continue
      try {
        await rm(temporaryProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        clean = false
      }
    }
    if (fixtureState)
      await rm(fixtureState, { force: true }).catch(() => {
        clean = false
      })
    result.cleanupConfirmed = clean
    if (!clean) result.completed = false
    result.finishedAt = new Date().toISOString()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(result, null, 2))
    if (!result.completed) process.exitCode = 1
  }
}

void main()
