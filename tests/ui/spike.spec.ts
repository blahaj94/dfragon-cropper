import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

let application: ElectronApplication | undefined
let temporaryDirectory: string | undefined

async function launchApp(mode?: 'success' | 'failure') {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'dfragon-ui-'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  delete environment.DFRAGON_FIXTURE
  delete environment.DFRAGON_STATE_FILE
  application = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: {
      ...environment,
      ...(mode ? { DFRAGON_FIXTURE: mode } : {}),
      DFRAGON_OUTPUT_DIR: join(temporaryDirectory, 'captures'),
      DFRAGON_USER_DATA: join(temporaryDirectory, 'user-data')
    }
  })
  const page = await application.firstWindow()
  await expect(page.getByRole('heading', { name: 'DFragonCropper', exact: true })).toBeVisible()
  if (mode)
    await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeEnabled()
  return page
}

test.afterEach(async () => {
  try {
    await application?.close()
  } finally {
    application = undefined
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
    temporaryDirectory = undefined
  }
})

test('boots with an isolated renderer and reflects a saved fixture capture', async () => {
  const page = await launchApp('success')
  await expect(page.getByRole('heading', { name: 'Windows Capture Spike' })).toBeVisible()
  await expect(page.getByText('Not yet captured', { exact: true })).toBeVisible()

  expect(
    await page.evaluate(() => ({
      require: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
      exposedMethods: Object.keys(window.spike).sort()
    }))
  ).toEqual({
    require: 'undefined',
    process: 'undefined',
    exposedMethods: ['captureNow', 'getState', 'onState']
  })
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  await expect(page.getByTestId('capture-counters')).toHaveText(
    'Completed: 1 · Failed: 0 · Skipped while busy: 0'
  )
  const state = await page.evaluate(() => window.spike.getState())
  expect(state.lastCapture).not.toBeNull()
  const capture = state.lastCapture!
  await expect(page.getByTestId('capture-event')).toHaveText(capture.eventId)
  await expect(page.getByTestId('capture-output')).toHaveText(capture.outputDirectory)
  await expect(page.getByTestId('capture-dimensions')).toHaveText(
    `${capture.width} × ${capture.height} physical pixels`
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
  const source = PNG.sync.read(await readFile(join(capture.outputDirectory, 'original.png')))
  expect({ width: source.width, height: source.height }).toEqual({
    width: capture.width,
    height: capture.height
  })

  // A capture outside the button handler must still reach the UI through onState.
  await page.evaluate(() => window.spike.captureNow())
  await expect(page.getByTestId('capture-counters')).toHaveText(
    'Completed: 2 · Failed: 0 · Skipped while busy: 0'
  )
})

test('shows capture failure without claiming a successful capture', async () => {
  const page = await launchApp('failure')
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('capture-counters')).toHaveText(
    'Completed: 0 · Failed: 1 · Skipped while busy: 0'
  )
  const state = await page.evaluate(() => window.spike.getState())
  expect(state.error).toBeTruthy()
  await expect(page.getByRole('alert')).toHaveText(state.error!)
  await expect(page.getByText('Not yet captured', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeEnabled()
})

test('explains Windows capture requirements on an unsupported host', async () => {
  test.skip(process.platform === 'win32', 'The native Windows host is supported.')
  const page = await launchApp()
  await expect(page.getByRole('note')).toHaveText(
    'Screen capture and PrintScreen detection require Windows 10.'
  )
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()
  await expect(page.getByText('Not yet captured', { exact: true })).toBeVisible()
})
