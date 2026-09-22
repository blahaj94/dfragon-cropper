import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { captureAndSave, type CaptureResult } from '../../src/main/capture'
import { IPC } from '../../src/shared/contracts'

let application: ElectronApplication | undefined
let temporaryDirectory: string | undefined

interface FixtureMetadata extends Record<string, unknown> {
  groundTruth?: { schemaVersion: number; regions: Record<string, string | null> }
}

type Answers = Record<number, Record<string, string | null>>

async function metadata(capture: CaptureResult): Promise<FixtureMetadata> {
  return JSON.parse(await readFile(join(capture.outputDirectory, 'metadata.json'), 'utf8'))
}

async function replaceMetadata(capture: CaptureResult, value: FixtureMetadata) {
  await writeFile(join(capture.outputDirectory, 'metadata.json'), JSON.stringify(value, null, 2))
}

async function launchGroundTruth(counts = [2, 3, 4], answers: Answers = {}) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'dfragon-ground-truth-ui-'))
  const outputRoot = join(temporaryDirectory, 'captures')
  const width = 320
  const height = 240
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([x % 256, y % 256, (x + y) % 256, 255], (y * width + x) * 4)
    }
  }
  const captures: CaptureResult[] = []
  // Write newest first: directory insertion order must not become the work order.
  // These are actual pipeline PNGs from a synthetic source, not native evidence.
  for (let index = counts.length - 1; index >= 0; index--) {
    const capture = await captureAndSave({
      outputRoot,
      trigger: 'fixture',
      profile: { id: 1, name: 'Synthetic nickname images' },
      regions: Array.from({ length: counts[index] }, (_, region) => ({
        id: region + 1,
        x: 10 + region * 30,
        y: 20 + region * 20,
        width: 120,
        height: 60
      })),
      captureFrame: () => ({
        width,
        height,
        rgba,
        capturedAt: new Date(Date.UTC(2026, 8, 22, 0, index)).toISOString(),
        backend: 'fixture'
      })
    })
    const value = await metadata(capture)
    value.fixtureNote = { purpose: 'Preserve unrelated metadata when saving answers', index }
    if (answers[index]) value.groundTruth = { schemaVersion: 1, regions: answers[index] }
    await replaceMetadata(capture, value)
    captures[index] = capture
  }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  delete environment.DFRAGON_STATE_FILE
  application = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: {
      ...environment,
      DFRAGON_FIXTURE: 'success',
      DFRAGON_OUTPUT_DIR: outputRoot,
      DFRAGON_USER_DATA: join(temporaryDirectory, 'user-data'),
      DFRAGON_CONFIG_FILE: join(temporaryDirectory, 'config.json')
    }
  })
  const page = await application.firstWindow()
  await page.getByRole('tab', { name: 'Ground Truth', exact: true }).click()
  await expect(group(page, captures[0])).toBeVisible()
  return { page, captures }
}

function group(page: Page, capture: CaptureResult) {
  return page.locator(`[data-testid="ground-truth-capture"][data-event-id="${capture.eventId}"]`)
}

function row(page: Page, capture: CaptureResult, regionId: number) {
  return group(page, capture).locator(
    `[data-testid="ground-truth-row"][data-region-id="${regionId}"]`
  )
}

function input(page: Page, capture: CaptureResult, regionId: number) {
  return row(page, capture, regionId).getByRole('textbox', {
    name: 'Character nickname',
    exact: true
  })
}

function bookmark(page: Page, capture: CaptureResult) {
  return page
    .getByRole('navigation', { name: 'Capture bookmarks', exact: true })
    .getByRole('button', { name: capture.eventId, exact: true })
}

async function savedAnswer(capture: CaptureResult, regionId: number, text: string | null) {
  await expect.poll(async () => (await metadata(capture)).groundTruth?.regions[regionId]).toBe(text)
}

test.afterEach(async () => {
  try {
    await application?.close()
  } finally {
    application = undefined
    if (temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    temporaryDirectory = undefined
  }
})

test('shows a continuous chronological capture feed and saves each image without changing capture data', async () => {
  const { page, captures } = await launchGroundTruth([2, 3, 4], {
    0: { '2': 'Existing answer' }
  })
  await expect(page.getByTestId('ground-truth-capture')).toHaveCount(3)
  expect(
    await page
      .getByTestId('ground-truth-capture')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-event-id')))
  ).toEqual(captures.map((capture) => capture.eventId))
  await expect(page.getByTestId('ground-truth-row')).toHaveCount(9)
  await bookmark(page, captures[2]).click()
  await expect
    .poll(() => page.getByTestId('ground-truth-feed').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  // Bookmark navigation scrolls the existing document; it must not swap its selected event.
  await expect(page.getByTestId('ground-truth-capture')).toHaveCount(3)
  await bookmark(page, captures[0]).click()
  const firstImage = row(page, captures[0], 1).getByTestId('ground-truth-image')
  const pngs = await Promise.all(
    captures
      .flatMap((capture) => [capture.originalPath!, ...capture.regions.map((r) => r.path)])
      .map(async (path) => ({ path, bytes: await readFile(path) }))
  )
  await expect(firstImage).toHaveAttribute(
    'src',
    `data:image/png;base64,${(await readFile(captures[0].regions[0].path)).toString('base64')}`
  )
  await page.screenshot({ path: test.info().outputPath('ground-truth-workspace.png') })
  const originalMetadata = await Promise.all(captures.map(metadata))
  await input(page, captures[0], 1).fill('  용기사_별빛🐉  ')
  await row(page, captures[0], 1).getByRole('button', { name: 'Save', exact: true }).click()
  await savedAnswer(captures[0], 1, '  용기사_별빛🐉  ')
  await input(page, captures[1], 1).fill('Another character')
  await row(page, captures[1], 1).getByRole('button', { name: 'Save', exact: true }).click()
  await savedAnswer(captures[1], 1, 'Another character')
  await input(page, captures[0], 1).fill('')
  await row(page, captures[0], 1).getByRole('button', { name: 'Save', exact: true }).click()
  await savedAnswer(captures[0], 1, null)
  expect((await metadata(captures[0])).groundTruth).toEqual({
    schemaVersion: 1,
    regions: { '1': null, '2': 'Existing answer' }
  })
  for (let index = 0; index < captures.length; index++) {
    const before = { ...originalMetadata[index] }
    const after = await metadata(captures[index])
    delete before.groundTruth
    delete after.groundTruth
    expect(after).toEqual(before)
  }
  for (const png of pngs) expect(await readFile(png.path)).toEqual(png.bytes)

  await page.getByRole('button', { name: 'Refresh captures', exact: true }).click()
  await expect(input(page, captures[0], 1)).toHaveValue('')
  await expect(input(page, captures[1], 1)).toHaveValue('Another character')
})

test('filters by saved text and independently keeps empty headings while Enter advances to an unanswered image', async () => {
  const { page, captures } = await launchGroundTruth([2, 3, 4], {
    0: { '1': 'Already answered', '2': null },
    1: { '1': 'Skip this saved answer' }
  })
  const hideAnswered = page.getByRole('checkbox', { name: 'Hide images with answers', exact: true })
  const showEmpty = page.getByRole('checkbox', { name: 'Show empty capture headings', exact: true })
  await expect(hideAnswered).not.toBeChecked()
  await expect(showEmpty).toBeChecked()
  await hideAnswered.check()
  await expect(page.getByTestId('ground-truth-row')).toHaveCount(7)
  await input(page, captures[0], 2).fill('마지막닉네임')
  await input(page, captures[0], 2).press('Enter')
  await savedAnswer(captures[0], 2, '마지막닉네임')
  await expect(input(page, captures[1], 2)).toBeFocused()
  await expect(group(page, captures[0]).getByTestId('ground-truth-row')).toHaveCount(0)
  await expect(bookmark(page, captures[0])).toBeVisible()
  await expect(group(page, captures[0])).toHaveCount(1)
  await showEmpty.uncheck()
  await expect(group(page, captures[0])).toHaveCount(0)
  await expect(bookmark(page, captures[0])).toHaveCount(0)
  await hideAnswered.uncheck()
  await expect(page.getByTestId('ground-truth-row')).toHaveCount(9)
  await expect(bookmark(page, captures[0])).toBeVisible()
  await input(page, captures[0], 2).fill('')
  await row(page, captures[0], 2).getByRole('button', { name: 'Save', exact: true }).click()
  await savedAnswer(captures[0], 2, null)
  await hideAnswered.check()
  await expect(input(page, captures[0], 2)).toHaveValue('')
  await expect(group(page, captures[0])).toHaveCount(1)
})

test('preserves drafts across navigation and refresh, ignores IME Enter, and recovers from an external metadata conflict', async () => {
  const { page, captures } = await launchGroundTruth()
  const first = captures[0]
  await input(page, first, 1).fill('작성 중 닉네임')
  await input(page, first, 1).dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true
  })
  await expect(row(page, first, 1).getByText('Unsaved changes', { exact: true })).toBeVisible()
  expect((await metadata(first)).groundTruth).toBeUndefined()
  await page.getByRole('tab', { name: 'Profiles', exact: true }).click()
  await page.getByRole('tab', { name: 'Ground Truth', exact: true }).click()
  await bookmark(page, captures[2]).click()
  await bookmark(page, first).click()
  await page.getByRole('button', { name: 'Refresh captures', exact: true }).click()
  await expect(input(page, first, 1)).toHaveValue('작성 중 닉네임')

  const external = await metadata(first)
  external.fixtureNote = { externalEdit: 'Must survive the failed stale save' }
  external.groundTruth = { schemaVersion: 1, regions: { '2': '외부에서 저장한 정답' } }
  await replaceMetadata(first, external)
  await page.getByRole('checkbox', { name: 'Hide images with answers', exact: true }).check()
  await row(page, first, 1).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(row(page, first, 1).getByRole('alert')).toContainText(/changed|reload/i)
  await expect(input(page, first, 1)).toHaveValue('작성 중 닉네임')
  expect(await metadata(first)).toEqual(external)
  await group(page, first)
    .getByRole('button', { name: 'Reload saved answers', exact: true })
    .click()
  await expect(input(page, first, 1)).toHaveValue('작성 중 닉네임')
  await row(page, first, 1).getByRole('button', { name: 'Save', exact: true }).click()
  await savedAnswer(first, 1, '작성 중 닉네임')
  expect((await metadata(first)).groundTruth?.regions).toEqual({
    '1': '작성 중 닉네임',
    '2': '외부에서 저장한 정답'
  })
  expect((await metadata(first)).fixtureNote).toEqual(external.fixtureNote)
})

test('does not replace a newer draft with a delayed save result or hide it after a failed retry', async () => {
  const { page, captures } = await launchGroundTruth()
  const first = captures[0]
  // Controlled transport responses cover renderer races only. The first test uses
  // the real save handler and checks the resulting metadata and every PNG byte.
  await application!.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_event, command) => {
      return new Promise((complete, fail) => {
        Reflect.set(globalThis, 'groundTruthPendingSave', {
          complete: () => complete({ ...command, revision: 'f'.repeat(64) }),
          fail: () => fail(new Error('Fixture metadata write failed'))
        })
      })
    })
  }, IPC.saveGroundTruth)
  await page.getByRole('checkbox', { name: 'Hide images with answers', exact: true }).check()
  await input(page, first, 1).fill('Submitted nickname')
  await input(page, first, 1).press('Enter')
  await expect(row(page, first, 1).getByText('Saving…', { exact: true })).toBeVisible()
  await expect(input(page, first, 1)).toBeFocused()
  await input(page, first, 1).fill('Newer unsaved nickname')
  await application!.evaluate(() => Reflect.get(globalThis, 'groundTruthPendingSave').complete())
  await expect(input(page, first, 1)).toHaveValue('Newer unsaved nickname')
  await expect(row(page, first, 1).getByText('Unsaved changes', { exact: true })).toBeVisible()
  await expect(row(page, first, 1).getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await row(page, first, 1).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(row(page, first, 1).getByText('Saving…', { exact: true })).toBeVisible()
  await application!.evaluate(() => Reflect.get(globalThis, 'groundTruthPendingSave').fail())
  await expect(row(page, first, 1).getByRole('alert')).toContainText(
    'Fixture metadata write failed'
  )
  await expect(input(page, first, 1)).toHaveValue('Newer unsaved nickname')
  await expect(row(page, first, 1).getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  expect((await metadata(first)).groundTruth).toBeUndefined()
})

test('loads the next chronological page and advances Enter across its boundary without dropping earlier drafts', async () => {
  const answers: Answers = {}
  for (let index = 0; index < 19; index++) answers[index] = { '1': `Completed ${index + 1}` }
  const { page, captures } = await launchGroundTruth(Array<number>(22).fill(1), answers)
  await expect(group(page, captures[19])).toHaveCount(1)
  await input(page, captures[0], 1).fill('Keep this earlier correction')
  await bookmark(page, captures[19]).click()
  await input(page, captures[19], 1).fill('Last answer on the first page')
  await input(page, captures[19], 1).press('Enter')
  await savedAnswer(captures[19], 1, 'Last answer on the first page')
  await expect(input(page, captures[20], 1)).toBeFocused()
  await expect(page.getByTestId('ground-truth-capture')).toHaveCount(22)
  expect(
    await page
      .getByTestId('ground-truth-capture')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-event-id')))
  ).toEqual(captures.map((capture) => capture.eventId))
  await bookmark(page, captures[0]).click()
  await expect(input(page, captures[0], 1)).toHaveValue('Keep this earlier correction')
  expect((await metadata(captures[0])).groundTruth?.regions['1']).toBe('Completed 1')
})
