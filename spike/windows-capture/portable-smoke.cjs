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
  experiment: 'portable-EXE-native-button-capture',
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

async function run() {
  await mkdir(dirname(output), { recursive: true })
  result.executableBytes = (await stat(executable)).size
  profile = await mkdtemp(join(dirname(output), 'portable-profile-'))
  const port = await freePort()
  const endpoint = `http://127.0.0.1:${port}`
  const environment = { ...process.env }
  for (const name of [
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
    { require: 'undefined', process: 'undefined', methods: ['captureNow', 'getState', 'onState'] }
  )
  result.rendererBoundaryVerified = true
  const initial = await page.evaluate(() => window.spike.getState())
  assert.equal(initial.platform, 'win32')
  assert.equal(initial.mode, 'keyboard-hook')
  assert.equal(initial.error, null)
  assert.equal(initial.completed, 0)
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
