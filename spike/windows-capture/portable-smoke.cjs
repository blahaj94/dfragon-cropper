/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS harness launches the built portable EXE. */
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
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
const verifyProfiles = process.argv.includes('--verify-profiles')
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
  experiment: verifyProfiles
    ? 'portable-profile-editor-native-capture'
    : 'portable-EXE-native-button-capture',
  transport: 'normal NSIS portable launch; Playwright over loopback CDP',
  injection: 'none; Capture Now button only',
  executable: basename(executable),
  startedAt: new Date().toISOString(),
  completed: false
}
let profile
let launcher
let browser
let page
let applicationPid

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

async function launchPortable() {
  const port = await freePort()
  const endpoint = `http://127.0.0.1:${port}`
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
  launcher = spawn(
    executable,
    [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`
    ],
    { cwd: dirname(executable), env: environment, stdio: 'ignore' }
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
      methods: ['captureNow', 'getState', 'onState', 'updateProfiles']
    }
  )
  result.rendererBoundaryVerified = true
}

async function closeForRestart() {
  await page.close()
  await browser.close()
  const deadline = Date.now() + 5_000
  while ((alive(applicationPid) || alive(launcher?.pid)) && Date.now() < deadline) await pause(100)
  assert(!alive(applicationPid) && !alive(launcher?.pid), 'Portable app did not exit cleanly')
  page = undefined
  browser = undefined
  launcher = undefined
  applicationPid = undefined
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
    join(dirname(executable), '.dev-captures').toLowerCase(),
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
  result.completed = true
}

async function main() {
  try {
    await run()
  } catch (error) {
    let message = String(error instanceof Error ? error.message : error)
    for (const path of [profile, dirname(executable), dirname(output)]) {
      if (path) message = message.replaceAll(path, '<private-path>')
    }
    result.error = message
  } finally {
    let clean = true
    if (page && !page.isClosed()) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    const deadline = Date.now() + 3_000
    while ((alive(applicationPid) || alive(launcher?.pid)) && Date.now() < deadline)
      await pause(100)
    for (const pid of new Set([applicationPid, launcher?.pid])) {
      if (!alive(pid)) continue
      result.forcedProcessCleanup = true
      await new Promise((accept) => {
        const kill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
        kill.once('exit', accept)
        kill.once('error', accept)
      })
      if (alive(pid)) clean = false
    }
    if (profile) {
      try {
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        clean = false
      }
    }
    result.cleanupConfirmed = clean
    if (!clean) result.completed = false
    result.finishedAt = new Date().toISOString()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(result, null, 2))
    if (!result.completed) process.exitCode = 1
  }
}

void main()
