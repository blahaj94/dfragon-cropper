import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { dragRoi, openRoiOverlay } from './roi-helpers'

let application: ElectronApplication | undefined
let temporaryDirectory: string | undefined

async function launchApp(
  mode?: 'success' | 'failure',
  options: { configContents?: string; captureEnabled?: boolean; rendererUrl?: string } = {}
) {
  temporaryDirectory ??= await mkdtemp(join(tmpdir(), 'dfragon-ui-'))
  const configFile = join(temporaryDirectory, 'config.json')
  if (options.configContents !== undefined) await writeFile(configFile, options.configContents)
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
      ...(options.rendererUrl ? { ELECTRON_RENDERER_URL: options.rendererUrl } : {}),
      DFRAGON_OUTPUT_DIR: join(temporaryDirectory, 'captures'),
      DFRAGON_USER_DATA: join(temporaryDirectory, 'user-data'),
      DFRAGON_CONFIG_FILE: configFile
    }
  })
  const page = await application.firstWindow()
  await expect(page.getByRole('heading', { name: 'DFragonCropper', exact: true })).toBeVisible()
  if (mode && options.captureEnabled !== false)
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
  await expect(page.getByRole('heading', { name: 'Profile Editor', exact: true })).toBeVisible()
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
    exposedMethods: [
      'captureNow',
      'getState',
      'listCaptures',
      'listGroundTruthCaptures',
      'minimizeToTray',
      'onSelectRoiRequested',
      'onState',
      'openCaptureFolder',
      'quit',
      'readCaptureImage',
      'readGroundTruthCapture',
      'readGroundTruthImage',
      'saveGroundTruth',
      'selectRoi',
      'updateProfiles'
    ]
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

test('preserves a configured file URL including query and fragment for trusted IPC', async () => {
  const url = pathToFileURL(resolve('out/renderer/index.html'))
  url.search = '?debug=1'
  url.hash = 'profiles'
  const page = await launchApp('success', { rendererUrl: url.href })
  expect(page.url()).toBe(url.href)
  const state = await page.evaluate(() => window.spike.getState())
  expect(state.mode).toBe('fixture')
  expect(state.settingsError).toBeNull()
  await expect(page.getByRole('alert')).toHaveCount(0)
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
  await expect(
    page.getByText('Screen capture and PrintScreen detection require Windows 10.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()
  await expect(page.getByText('Not yet captured', { exact: true })).toBeVisible()
})

test('edits saved profiles, preserves drafts during capture, and persists immutable ROI IDs', async () => {
  let page = await launchApp('success')
  await page.getByLabel('New profile name', { exact: true }).fill('Game')
  await page.getByRole('button', { name: 'Create profile', exact: true }).click()
  await expect(page.getByTestId('active-profile')).toHaveText('Active capture profile: Game (#2)')
  await expect(page.getByLabel('Edit profile', { exact: true })).toHaveValue('2')
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()

  // Editing selection and active capture selection have separate, visible effects.
  await page.getByLabel('Edit profile', { exact: true }).selectOption('1')
  await expect(page.getByTestId('active-profile')).toContainText('Game (#2)')
  await page.getByRole('button', { name: 'Use for captures', exact: true }).click()
  await expect(page.getByTestId('active-profile')).toContainText('Default (#1)')
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeEnabled()
  await page.getByLabel('Edit profile', { exact: true }).selectOption('2')
  await page.getByRole('button', { name: 'Use for captures', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()

  await page.getByLabel('Profile name', { exact: true }).fill('Arena')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.getByTestId('active-profile')).toContainText('Arena (#2)')
  const newRoi = () => page.getByRole('group', { name: 'New ROI', exact: true })
  await newRoi().getByLabel('X', { exact: true }).fill('17')
  await newRoi().getByLabel('Y', { exact: true }).fill('29')
  await newRoi().getByLabel('Width', { exact: true }).fill('31')
  await newRoi().getByLabel('Height', { exact: true }).fill('19')
  await newRoi().getByRole('button', { name: 'Add ROI', exact: true }).click()
  const firstRoi = () => page.getByRole('group', { name: 'ROI #1', exact: true })
  await expect(firstRoi().getByLabel('X', { exact: true })).toHaveValue('17')

  await firstRoi().getByLabel('X', { exact: true }).fill('30')
  await page.getByLabel('Profile name', { exact: true }).fill('Unsaved name')
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 1')
  await expect(firstRoi().getByLabel('X', { exact: true })).toHaveValue('30')
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Unsaved name')
  const capture = (await page.evaluate(() => window.spike.getState())).lastCapture!
  expect(capture.profile).toEqual({ id: 2, name: 'Arena' })
  expect(capture.regions).toHaveLength(1)
  expect(capture.regions[0]).toMatchObject({ id: 1, x: 17, y: 29, width: 31, height: 19 })
  const source = PNG.sync.read(await readFile(join(capture.outputDirectory, 'original.png')))
  const cropped = PNG.sync.read(await readFile(capture.regions[0].path))
  expect([cropped.width, cropped.height]).toEqual([31, 19])
  for (let row = 0; row < cropped.height; row++) {
    const start = ((29 + row) * source.width + 17) * 4
    expect(cropped.data.subarray(row * 31 * 4, (row + 1) * 31 * 4)).toEqual(
      source.data.subarray(start, start + 31 * 4)
    )
  }
  await page.getByLabel('Edit profile', { exact: true }).selectOption('1')
  await page.getByLabel('Edit profile', { exact: true }).selectOption('2')
  await expect(firstRoi().getByLabel('X', { exact: true })).toHaveValue('30')
  await page.getByRole('button', { name: 'Discard name changes', exact: true }).click()
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Arena')
  await firstRoi().getByRole('button', { name: 'Save ROI', exact: true }).click()
  await expect(firstRoi().getByRole('button', { name: 'Save ROI', exact: true })).toBeDisabled()

  await newRoi().getByRole('button', { name: 'Add ROI', exact: true }).click()
  const secondRoi = page.getByRole('group', { name: 'ROI #2', exact: true })
  await secondRoi.getByRole('button', { name: 'Delete ROI', exact: true }).click()
  await expect(secondRoi).toHaveCount(0)
  await newRoi().getByRole('button', { name: 'Add ROI', exact: true }).click()
  await expect(page.getByRole('group', { name: 'ROI #3', exact: true })).toBeVisible()

  await application!.close()
  application = undefined
  page = await launchApp('success')
  await expect(page.getByTestId('active-profile')).toContainText('Arena (#2)')
  await expect(firstRoi().getByLabel('X', { exact: true })).toHaveValue('30')
  await expect(page.getByRole('group', { name: 'ROI #2', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'ROI #3', exact: true })).toBeVisible()
  const persisted = JSON.parse(await readFile(join(temporaryDirectory!, 'config.json'), 'utf8'))
  expect(persisted.activeProfileId).toBe(2)
  expect(
    persisted.profiles
      .find((profile: { id: number }) => profile.id === 2)
      .regions.map((region: { id: number }) => region.id)
  ).toEqual([1, 3])

  await page.getByRole('button', { name: 'Delete profile', exact: true }).click()
  await expect(page.getByTestId('active-profile')).toContainText('Default (#1)')
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click()
  await expect(page.getByTestId('active-profile')).toHaveText('Active capture profile: None')
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Edit profile', { exact: true })).toHaveCount(0)
})

test('reports rejected edits and leaves a corrupt configuration unchanged', async () => {
  let page = await launchApp('success')
  await page.getByLabel('Profile name', { exact: true }).fill('   ')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Changes were not saved.')
  await expect(page.getByTestId('active-profile')).toContainText('Default (#1)')
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('   ')
  await application!.close()
  application = undefined
  const broken = '{ "schemaVersion": 1, "profiles": BROKEN }\n'
  page = await launchApp('success', { configContents: broken, captureEnabled: false })
  await expect(page.getByRole('alert')).toContainText('Configuration needs attention.')
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create profile', exact: true })).toHaveCount(0)
  expect(await readFile(join(temporaryDirectory!, 'config.json'), 'utf8')).toBe(broken)
})

test('keeps configuration errors visible across tabs and blocks editing without losing drafts', async () => {
  const page = await launchApp('success')
  await page.getByLabel('Profile name', { exact: true }).fill('Unsaved profile name')
  const firstRoi = page.getByRole('group', { name: 'ROI #1', exact: true })
  await firstRoi.getByLabel('X', { exact: true }).fill('19')
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Save original PNG', { exact: true }).uncheck()

  const configFile = join(temporaryDirectory!, 'config.json')
  const externalContents = `${await readFile(configFile, 'utf8')}\n`
  await writeFile(configFile, externalContents)
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('Profile config changed outside this app.')
  await expect(page.getByLabel('Save original PNG', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Save original PNG', { exact: true })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeDisabled()

  await page.getByRole('tab', { name: 'Captures', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Captures and editing are paused;')
  await page.getByRole('tab', { name: 'Profiles', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Unsaved profile name')
  await expect(page.getByLabel('Profile name', { exact: true })).toBeDisabled()
  await expect(firstRoi.getByLabel('X', { exact: true })).toHaveValue('19')
  await expect(firstRoi.getByLabel('X', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Select ROI (F12)', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save name', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByLabel('Save original PNG', { exact: true })).not.toBeChecked()
  const state = await page.evaluate(() => window.spike.getState())
  expect(state.settings?.preferences.saveOriginal).toBe(true)
  expect(state.settings?.profiles[0].name).toBe('Default')
  expect(await readFile(configFile, 'utf8')).toBe(externalContents)
})

test('draws physical ROIs, previews saved history, and persists original-saving preferences', async () => {
  let page = await launchApp('success')
  await page.getByLabel('New profile name', { exact: true }).fill('Drawn')
  await page.getByRole('button', { name: 'Create profile', exact: true }).click()
  await expect(page.getByTestId('active-profile')).toContainText('Drawn (#2)')
  const overlay = await openRoiOverlay(application!, page)
  await dragRoi(overlay)
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 0')
  await expect(page.getByTestId('drawn-rectangle')).toHaveText(
    'X 10 · Y 20 · Width 51 · Height 41 physical pixels'
  )
  await page.getByRole('button', { name: 'Add drawn ROI', exact: true }).click()
  await expect(
    page.getByRole('group', { name: 'ROI #1', exact: true }).getByLabel('X', { exact: true })
  ).toHaveValue('10')
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 1')
  const first = (await page.evaluate(() => window.spike.getState())).lastCapture!
  expect(first.regions[0]).toMatchObject({ id: 1, x: 10, y: 20, width: 51, height: 41 })
  const source = PNG.sync.read(await readFile(join(first.outputDirectory, 'original.png')))
  const roi = PNG.sync.read(await readFile(first.regions[0].path))
  for (let row = 0; row < roi.height; row++) {
    const offset = ((20 + row) * source.width + 10) * 4
    expect(roi.data.subarray(row * roi.width * 4, (row + 1) * roi.width * 4)).toEqual(
      source.data.subarray(offset, offset + roi.width * 4)
    )
  }

  await page.getByRole('tab', { name: 'Captures', exact: true }).click()
  await expect(page.getByLabel('Capture event', { exact: true })).toHaveValue(first.eventId)
  await expect
    .poll(() =>
      page.getByTestId('history-image').evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(320)
  await page.getByLabel('Capture image', { exact: true }).selectOption('1')
  await expect
    .poll(() =>
      page
        .getByTestId('history-image')
        .evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])
    )
    .toEqual([51, 41])
  const url = await page.getByTestId('history-image').getAttribute('src')
  expect(PNG.sync.read(Buffer.from(url!.split(',')[1], 'base64')).data).toEqual(roi.data)

  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Save original PNG', { exact: true }).uncheck()
  await page.getByLabel('Close window to tray', { exact: true }).uncheck()
  await page.getByRole('tab', { name: 'Profiles', exact: true }).click()
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Save original PNG', { exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 2')
  const second = (await page.evaluate(() => window.spike.getState())).lastCapture!
  expect(second.originalSaved).toBe(false)
  await expect(readFile(join(second.outputDirectory, 'original.png'))).rejects.toMatchObject({
    code: 'ENOENT'
  })

  await application!.close()
  application = undefined
  page = await launchApp('success')
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Save original PNG', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('Close window to tray', { exact: true })).not.toBeChecked()
  await page.getByRole('tab', { name: 'Captures', exact: true }).click()
  await expect(page.getByLabel('Capture event', { exact: true })).toHaveValue(second.eventId)
  await expect(
    page.getByText('Original image was not saved for this capture.', { exact: true })
  ).toBeVisible()
  await expect(page.getByLabel('Capture image', { exact: true }).getByRole('option')).toHaveCount(1)
  await expect
    .poll(() =>
      page
        .getByTestId('history-image')
        .evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])
    )
    .toEqual([51, 41])
  await page.getByLabel('Capture event', { exact: true }).selectOption(first.eventId)
  await expect(page.getByLabel('Capture image', { exact: true }).getByRole('option')).toHaveCount(2)
})

test('finishes all capture files before quitting with a capture in progress', async () => {
  const page = await launchApp('success')
  const closed = application!.waitForEvent('close', { timeout: 10_000 })
  await page.evaluate(() => {
    void window.spike.captureNow()
    void window.spike.quit()
  })
  await closed
  application = undefined
  const output = join(temporaryDirectory!, 'captures')
  const events = (await readdir(output, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory()
  )
  expect(events).toHaveLength(1)
  const directory = join(output, events[0].name)
  const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'))
  expect(metadata.eventId).toBe(events[0].name)
  expect(metadata.regions).toHaveLength(2)
  const original = PNG.sync.read(await readFile(join(directory, metadata.source.file)))
  expect([original.width, original.height]).toEqual([320, 240])
  for (const region of metadata.regions) {
    const roi = PNG.sync.read(await readFile(join(directory, region.file)))
    expect([roi.width, roi.height]).toEqual([region.width, region.height])
  }
})
