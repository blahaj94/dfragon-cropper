/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS harness launches the actual Electron product. */
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')
const { release } = require('node:os')
const { _electron } = require('@playwright/test')
const koffi = require('koffi')

const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const output = argument('--output')
const manual = process.argv.includes('--manual')
const readyPath = argument('--ready')
if (process.platform !== 'win32' || !output) throw new Error('Run on Windows with --output <JSON>.')
if (manual && !readyPath) throw new Error('Manual mode requires --ready <JSON>.')
const appRoot = resolve(argument('--app-root') || join(__dirname, '../..'))
const electronExecutable = argument('--electron-path') || require('electron')
const pressCount = Number(argument('--press-count') || 20)
assert(Number.isInteger(pressCount) && pressCount >= 1 && pressCount <= 20)
const pause = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds))
const result = {
  schemaVersion: 1,
  experiment: 'actual-product-button-and-background-PrintScreen-capture',
  injection: manual
    ? 'manual mode; no synthetic injection'
    : 'synthetic keybd_event; physical keyboard unverified',
  platform: process.platform,
  release: release(),
  scope: 'Actual product with a separate foreground process; elevated games are not exercised.',
  requestedPrintScreenCaptures: pressCount,
  startedAt: new Date().toISOString(),
  samples: []
}
let application
let fixture
let profile
let fixtureProfile
let fixtureState
let outputRoot
let overallDeadline

function redact(message) {
  let text = String(message)
  for (const path of [appRoot, profile, fixtureProfile, outputRoot, dirname(output)]) {
    if (path) text = text.replaceAll(path, '<private-path>')
  }
  return text
}

async function run() {
  await mkdir(dirname(output), { recursive: true })
  profile = await mkdtemp(join(dirname(output), 'product-flow-profile-'))
  outputRoot = join(appRoot, '.dev-captures', `product-flow-${Date.now()}`)
  const environment = {
    ...process.env,
    DFRAGON_USER_DATA: profile,
    DFRAGON_OUTPUT_DIR: outputRoot,
    DFRAGON_CONFIG_FILE: join(profile, 'config.json')
  }
  for (const variable of [
    'DFRAGON_FIXTURE',
    'DFRAGON_TRIGGER',
    'DFRAGON_STATE_FILE',
    'ELECTRON_RENDERER_URL',
    'ELECTRON_RUN_AS_NODE'
  ]) {
    delete environment[variable]
  }
  application = await _electron.launch({
    executablePath: electronExecutable,
    args: [join(appRoot, 'out/main/index.js')],
    cwd: appRoot,
    env: environment,
    timeout: 10_000
  })
  const page = await application.firstWindow({ timeout: 10_000 })
  page.setDefaultTimeout(10_000)
  await page.waitForFunction(() => typeof window.spike?.getState === 'function')
  const runtime = await application.evaluate(({ app, screen }) => ({
    version: process.versions.electron,
    pid: process.pid,
    userData: app.getPath('userData'),
    scaleFactor: screen.getPrimaryDisplay().scaleFactor,
    boundsDip: screen.getPrimaryDisplay().bounds
  }))
  assert.equal(
    resolve(runtime.userData).toLowerCase(),
    resolve(profile).toLowerCase(),
    'Profile is not isolated'
  )
  result.electron = runtime.version
  result.processId = runtime.pid
  result.primaryDisplay = { scaleFactor: runtime.scaleFactor, boundsDip: runtime.boundsDip }
  const state = () => page.evaluate(() => window.spike.getState())
  const initial = await state()
  assert.equal(initial.mode, 'keyboard-hook')
  assert.equal(initial.error, null)
  assert.equal(initial.settingsError, null)
  assert.equal(initial.settings.schemaVersion, 3)
  assert.equal(initial.settings.shortcuts.capture.key, 'PrintScreen')
  assert.equal(initial.settings.preferences.saveOriginal, true)
  assert.equal(initial.completed, 0)
  const activeProfile = initial.settings.profiles.find(
    (profile) => profile.id === initial.settings.activeProfileId
  )
  assert(activeProfile?.regions.length, 'No saved active ROI profile was loaded')
  const events = new Set()
  async function waitForCapture(expected, trigger, timeout = 5_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const current = await state()
      result.lastObservedState = {
        completed: current.completed,
        failed: current.failed,
        skipped: current.skipped,
        busy: current.busy,
        error: current.error === null ? null : redact(current.error),
        triggerStatus: current.triggerStatus,
        lastTrigger: current.lastCapture?.trigger ?? null
      }
      assert.equal(current.failed, 0, current.error || 'Capture failed')
      assert.equal(current.skipped, 0, 'A key was skipped while busy')
      if (current.completed === expected && !current.busy) {
        const capture = current.lastCapture
        assert.equal(capture.trigger, trigger)
        assert(!events.has(capture.eventId), 'Event ID was reused')
        events.add(capture.eventId)
        const metadata = JSON.parse(
          await readFile(join(capture.outputDirectory, 'metadata.json'), 'utf8')
        )
        assert.equal(metadata.eventId, capture.eventId)
        assert.equal(metadata.trigger, trigger)
        assert.equal(metadata.source.backend, 'win32-gdi')
        assert.equal(metadata.source.file, 'original.png')
        assert.equal(metadata.profile.id, activeProfile.id)
        assert.deepEqual(
          metadata.regions.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
          activeProfile.regions
        )
        for (const file of [
          metadata.source.file,
          ...metadata.regions.map((region) => region.file)
        ]) {
          assert((await stat(join(capture.outputDirectory, file))).size > 0, 'Saved PNG is empty')
        }
        return current
      }
      assert(current.completed <= expected, 'One press produced multiple captures')
      await pause(25)
    }
    throw new Error('Capture did not complete before the observation deadline')
  }

  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  const button = await waitForCapture(1, 'button')
  result.buttonCapture = {
    completed: true,
    width: button.lastCapture.width,
    height: button.lastCapture.height
  }

  const user32 = koffi.load('user32.dll')
  const getForeground = user32.func('__stdcall', 'GetForegroundWindow', 'uintptr_t', [])
  const getWindowProcess = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32_t', [
    'uintptr_t',
    koffi.out(koffi.pointer('uint32_t'))
  ])
  const allowForeground = user32.func('__stdcall', 'AllowSetForegroundWindow', 'bool', ['uint32_t'])
  const keybdEvent = user32.func('__stdcall', 'keybd_event', 'void', [
    'uint8_t',
    'uint8_t',
    'uint32_t',
    'uintptr_t'
  ])
  const getSequence = user32.func('__stdcall', 'GetClipboardSequenceNumber', 'uint32_t', [])
  const foregroundPid = () => {
    const pid = [0]
    getWindowProcess(getForeground(), pid)
    return pid[0]
  }
  fixtureState = join(dirname(output), `product-focus-${Date.now()}.json`)
  fixture = spawn(
    electronExecutable,
    [
      join(__dirname, 'global-shortcut-probe.cjs'),
      '--focus-fixture',
      '--fixture-state',
      fixtureState,
      '--fixture-lifetime-ms',
      manual ? '240000' : '30000',
      ...(manual ? ['--manual-fixture'] : [])
    ],
    {
      env: environment,
      stdio: 'ignore'
    }
  )
  let fixtureError
  fixture.once('error', (error) => (fixtureError = error))
  assert(fixture.pid, 'Foreground fixture did not start')
  fixtureProfile = join(dirname(fixtureState), `profile-${fixture.pid}`)
  allowForeground(fixture.pid)
  const focusDeadline = Date.now() + 8_000
  while (foregroundPid() !== fixture.pid && Date.now() < focusDeadline) {
    if (fixtureError) throw fixtureError
    assert.equal(fixture.exitCode, null, 'Foreground fixture exited before acquiring focus')
    await pause(100)
  }
  assert.equal(foregroundPid(), fixture.pid, 'Separate fixture did not become foreground')
  const clipboardBefore = getSequence()
  if (manual) {
    await writeFile(
      readyPath,
      JSON.stringify({
        ready: true,
        completedPresses: 0,
        requestedPresses: pressCount,
        scaleFactor: runtime.scaleFactor
      })
    )
  }
  for (let index = 0; index < pressCount; index++) {
    assert.equal(foregroundPid(), fixture.pid, 'Foreground changed; no further keys injected')
    assert.notEqual(foregroundPid(), runtime.pid, 'Product unexpectedly acquired foreground')
    const sequenceBefore = getSequence()
    const start = performance.now()
    if (!manual) {
      keybdEvent(0x2c, 0x37, 0x0001, 0)
      try {
        await pause(40)
      } finally {
        keybdEvent(0x2c, 0x37, 0x0001 | 0x0002, 0)
      }
    }
    await waitForCapture(index + 2, 'printscreen', manual ? 180_000 : 5_000)
    const clipboardDeadline = Date.now() + 1_000
    while (getSequence() === sequenceBefore && Date.now() < clipboardDeadline) await pause(25)
    assert.notEqual(getSequence(), sequenceBefore, 'Default clipboard capture was suppressed')
    assert.equal(foregroundPid(), fixture.pid, 'Product stole foreground during capture')
    result.samples.push({
      press: index + 1,
      completed: index + 2,
      ...(manual
        ? { waitedMs: Math.round(performance.now() - start) }
        : { elapsedMs: Math.round(performance.now() - start) }),
      productRemainedBackground: true,
      savedRoiCount: activeProfile.regions.length,
      clipboardSequenceChanged: true
    })
    if (manual) {
      await writeFile(
        readyPath,
        JSON.stringify({
          ready: true,
          completedPresses: index + 1,
          requestedPresses: pressCount,
          scaleFactor: runtime.scaleFactor
        })
      )
    }
  }
  const final = await state()
  result.final = {
    completed: final.completed,
    failed: final.failed,
    skipped: final.skipped,
    uniqueSavedEvents: events.size,
    lastTrigger: final.lastCapture.trigger,
    clipboardSequenceBefore: clipboardBefore,
    clipboardSequenceAfter: getSequence()
  }
  result.completed = final.completed === pressCount + 1
}

async function main() {
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        overallDeadline = setTimeout(
          () => reject(new Error('Product-flow probe exceeded its overall deadline')),
          manual ? 180_000 : 55_000
        )
      })
    ])
  } catch (error) {
    result.completed = false
    result.error = redact(error instanceof Error ? error.message : error)
  } finally {
    clearTimeout(overallDeadline)
    let clean = true
    if (application) {
      let closeDeadline
      try {
        await Promise.race([
          application.close(),
          new Promise((_, reject) => {
            closeDeadline = setTimeout(() => reject(new Error('Product did not quit')), 5_000)
          })
        ])
      } catch {
        // Only the product process tree launched by this probe may be terminated.
        const pid = application.process().pid
        if (pid) spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { timeout: 5_000 })
        clean = false
      } finally {
        clearTimeout(closeDeadline)
      }
    }
    if (fixture) {
      // Include the fixture's renderers, so a failed probe cannot leave foreground UI behind.
      if (fixture.pid && fixture.exitCode === null && fixture.signalCode === null)
        spawnSync('taskkill.exe', ['/pid', String(fixture.pid), '/T', '/F'], {
          timeout: 5_000,
          stdio: 'ignore'
        })
      const fixtureExited = await new Promise((accept) => {
        if (fixture.exitCode !== null || fixture.signalCode !== null) return accept(true)
        const deadline = setTimeout(() => accept(false), 2_000)
        fixture.once('exit', () => {
          clearTimeout(deadline)
          accept(true)
        })
      })
      clean = clean && fixtureExited
    }
    for (const path of [profile, fixtureProfile, fixtureState]) {
      if (!path) continue
      try {
        await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        clean = false
      }
    }
    result.cleanupConfirmed = clean
    if (!clean) result.completed = false
    result.finishedAt = new Date().toISOString()
    await writeFile(output, JSON.stringify(result, null, 2))
    process.exitCode = result.completed ? 0 : 1
    if (manual) {
      await writeFile(
        readyPath,
        JSON.stringify({
          ready: false,
          finished: true,
          completedPresses: result.samples.length,
          completed: result.completed
        })
      )
    }
  }
}

void main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
