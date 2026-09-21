/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Electron CJS entry with runtime module paths. */
// Windows-only, synthetic-key experiment. This does not prove a physical key works.
const { app, BrowserWindow, clipboard, globalShortcut, nativeImage, screen } = require('electron')
const { spawn } = require('node:child_process')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

function argument(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const resultPath = argument('--output')
const fixtureStatePath = argument('--fixture-state')
const isFixture = process.argv.includes('--focus-fixture')
if (process.platform !== 'win32' || (!resultPath && !fixtureStatePath)) {
  throw new Error('Run on Windows with --output <json path>.')
}
const profile = join(dirname(resultPath || fixtureStatePath), `profile-${process.pid}`)
app.setPath('userData', profile)
app.setName(isFixture ? 'DFragonCropper focus fixture' : 'DFragonCropper shortcut probe')

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let fixture
let nativeListener
let callbackCount = 0

async function run() {
  if (isFixture) {
    const lifetime = Number(argument('--fixture-lifetime-ms') || 30_000)
    if (!Number.isInteger(lifetime) || lifetime < 1_000 || lifetime > 240_000) {
      throw new Error('Fixture lifetime must be between 1000 and 240000 milliseconds.')
    }
    const fixtureMessage = process.argv.includes('--manual-fixture')
      ? 'Press the physical PrintScreen key 20 times. Wait at least TWO SECONDS between presses.'
      : 'Synthetic PrintScreen baseline is running.'
    const window = new BrowserWindow({
      width: 900,
      height: 600,
      title: 'DFragonCropper — separate foreground fixture',
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await window.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          `<html><body style="margin:0;background:#162c46;color:#fff;font:24px system-ui;display:grid;place-items:center;height:100vh"><main><h1>DFragonCropper capture fixture</h1><p>This window belongs to a separate process.</p><p>${fixtureMessage}</p></main></body></html>`
        )
    )
    window.show()
    window.focus()
    app.focus({ steal: true })
    writeFileSync(fixtureStatePath, JSON.stringify({ pid: process.pid }))
    setTimeout(() => app.quit(), lifetime)
    return
  }

  const report = {
    schemaVersion: 1,
    experiment: 'electron-globalShortcut-PrintScreen',
    injection: 'synthetic keybd_event; physical keyboard unverified',
    startedAt: new Date().toISOString(),
    electron: process.versions.electron,
    architecture: process.arch,
    platform: process.platform,
    processId: process.pid,
    explicitClipboardWrites: false,
    registration: null,
    callbacks: 0,
    phases: []
  }
  mkdirSync(dirname(resultPath), { recursive: true })
  try {
    const koffi = require(argument('--koffi') || 'koffi')
    const user32 = koffi.load('user32.dll')
    const getSequence = user32.func('__stdcall', 'GetClipboardSequenceNumber', 'uint32_t', [])
    const getForeground = user32.func('__stdcall', 'GetForegroundWindow', 'uintptr_t', [])
    const getWindowProcess = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32_t', [
      'uintptr_t',
      koffi.out(koffi.pointer('uint32_t'))
    ])
    const allowForeground = user32.func('__stdcall', 'AllowSetForegroundWindow', 'bool', [
      'uint32_t'
    ])
    const keybdEvent = user32.func('__stdcall', 'keybd_event', 'void', [
      'uint8_t',
      'uint8_t',
      'uint32_t',
      'uintptr_t'
    ])
    function foreground() {
      const handle = getForeground()
      const pid = [0]
      getWindowProcess(handle, pid)
      return {
        handle: String(handle),
        processId: pid[0],
        probeIsForeground: pid[0] === process.pid
      }
    }
    async function clipboardState() {
      let image
      let formats
      if (typeof clipboard.readImage === 'function') {
        image = clipboard.readImage()
        formats = clipboard.availableFormats()
      } else {
        // Electron 44 uses asynchronous ClipboardItem objects instead of readImage().
        const items = await clipboard.read()
        formats = [...new Set(items.flatMap((item) => item.types))]
        const imageItem = items.find((item) => item.types.includes('image/png'))
        image = imageItem
          ? nativeImage.createFromBuffer(
              Buffer.from(await (await imageItem.getType('image/png')).arrayBuffer())
            )
          : nativeImage.createEmpty()
      }
      return {
        sequence: getSequence(),
        formats,
        imageSize: image.isEmpty() ? null : image.getSize()
      }
    }

    const display = screen.getPrimaryDisplay()
    report.primaryDisplay = {
      id: display.id,
      scaleFactor: display.scaleFactor,
      boundsDip: display.bounds
    }
    const statePath = resultPath + '.foreground.json'
    const childEnvironment = { ...process.env }
    delete childEnvironment.ELECTRON_RUN_AS_NODE
    fixture = spawn(
      process.execPath,
      [__filename, '--focus-fixture', '--fixture-state', statePath],
      { env: childEnvironment, stdio: 'ignore' }
    )
    if (!fixture.pid) throw new Error('Could not start the separate foreground fixture.')
    allowForeground(fixture.pid)
    const deadline = Date.now() + 10_000
    let fixtureReady = false
    while (Date.now() < deadline) {
      try {
        fixtureReady = JSON.parse(readFileSync(statePath, 'utf8')).pid === fixture.pid
      } catch {
        // The separate fixture has not finished loading yet.
      }
      if (fixtureReady && foreground().processId === fixture.pid) break
      await pause(100)
    }
    report.fixtureProcessId = fixture.pid
    report.initialForeground = foreground()
    if (!fixtureReady || report.initialForeground.processId !== fixture.pid) {
      throw new Error('The separate fixture did not acquire foreground focus; no keys injected.')
    }
    await pause(500)

    async function phase(name, repeatedKeydowns = 0) {
      const before = await clipboardState()
      const callbacksBefore = callbackCount
      const focusedBefore = foreground()
      if (focusedBefore.processId !== fixture.pid) {
        throw new Error('Foreground changed away from the fixture; no keys injected.')
      }
      // Extended PrintScreen key down/up. No clipboard mutation is performed by this probe.
      keybdEvent(0x2c, 0x37, 0x0001, 0)
      for (let repeat = 0; repeat < repeatedKeydowns; repeat++) {
        await pause(40)
        keybdEvent(0x2c, 0x37, 0x0001, 0)
      }
      await pause(80)
      keybdEvent(0x2c, 0x37, 0x0001 | 0x0002, 0)
      await pause(1_500)
      const after = await clipboardState()
      const focusedAfter = foreground()
      const result = {
        name,
        syntheticRepeatedKeydowns: repeatedKeydowns,
        before,
        after,
        clipboardSequenceChanged: before.sequence !== after.sequence,
        clipboardContainsImage: after.imageSize !== null,
        callbackDelta: callbackCount - callbacksBefore,
        foregroundBefore: focusedBefore,
        foregroundAfter: focusedAfter,
        probeRemainedBackground: !focusedBefore.probeIsForeground && !focusedAfter.probeIsForeground
      }
      report.phases.push(result)
      return result
    }

    const baseline = await phase('unregistered-default-behavior')
    report.registration = globalShortcut.register('PrintScreen', () => {
      callbackCount += 1
    })
    report.isRegistered = globalShortcut.isRegistered('PrintScreen')
    const registered = await phase('registered-globalShortcut')
    report.syntheticBackgroundDetection =
      registered.callbackDelta > 0 && registered.probeRemainedBackground
    report.defaultClipboardPreserved =
      baseline.clipboardSequenceChanged &&
      baseline.clipboardContainsImage &&
      registered.clipboardSequenceChanged &&
      registered.clipboardContainsImage
    globalShortcut.unregisterAll()

    const hookModule = argument('--hook')
    if (hookModule) {
      const { startPrintScreenListener } = require(hookModule)
      nativeListener = startPrintScreenListener(() => {
        callbackCount += 1
      })
      const native = await phase('native-pass-through-hook')
      const repeated = await phase('native-repeat-deduplication-after-keyup', 3)
      report.nativeHook = {
        installed: true,
        syntheticBackgroundDetection: native.callbackDelta === 1 && native.probeRemainedBackground,
        defaultClipboardPreserved:
          baseline.clipboardSequenceChanged &&
          baseline.clipboardContainsImage &&
          native.clipboardSequenceChanged &&
          native.clipboardContainsImage,
        repeatDeduplicated: repeated.callbackDelta === 1,
        keyupReset: repeated.callbackDelta === 1
      }
      const pressCount = Number(argument('--press-count') || 0)
      if (!Number.isInteger(pressCount) || pressCount < 0 || pressCount > 100) {
        throw new Error('--press-count must be an integer from 0 through 100.')
      }
      if (pressCount > 0) {
        const samples = []
        const callbacksBefore = callbackCount
        const sequenceBefore = getSequence()
        for (let index = 0; index < pressCount; index++) {
          if (foreground().processId !== fixture.pid) {
            throw new Error('Foreground changed away from the fixture during repeated presses.')
          }
          const countBefore = callbackCount
          keybdEvent(0x2c, 0x37, 0x0001, 0)
          await pause(40)
          keybdEvent(0x2c, 0x37, 0x0001 | 0x0002, 0)
          await pause(160)
          samples.push({
            index: index + 1,
            callbackDelta: callbackCount - countBefore,
            probeRemainedBackground: !foreground().probeIsForeground,
            clipboardSequence: getSequence()
          })
        }
        report.nativeHook.repeatedPresses = {
          requested: pressCount,
          callbacks: callbackCount - callbacksBefore,
          everyPressObservedOnce: samples.every((sample) => sample.callbackDelta === 1),
          allRemainedBackground: samples.every((sample) => sample.probeRemainedBackground),
          clipboardSequenceBefore: sequenceBefore,
          clipboardSequenceAfter: getSequence(),
          samples
        }
      }
      nativeListener.stop()
      nativeListener = undefined
    }
    report.completed = true
  } catch (error) {
    report.completed = false
    report.error = String(error && error.message ? error.message : error)
  } finally {
    globalShortcut.unregisterAll()
    try {
      nativeListener?.stop()
    } catch (error) {
      report.completed = false
      report.cleanupError = String(error)
    }
    report.callbacks = callbackCount
    report.finishedAt = new Date().toISOString()
    writeFileSync(resultPath, JSON.stringify(report, null, 2))
    fixture?.kill()
    app.quit()
  }
}

app
  .whenReady()
  .then(run)
  .catch((error) => {
    if (resultPath)
      writeFileSync(resultPath, JSON.stringify({ completed: false, error: String(error) }))
    app.exit(1)
  })
