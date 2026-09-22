import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { captureAndSave } from '../../src/main/capture'
import { IPC } from '../../src/shared/contracts'

let application: ElectronApplication | undefined
let temporaryDirectory: string | undefined

async function launchWithLargeCapture() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'dfragon-history-ui-'))
  const outputRoot = join(temporaryDirectory, 'captures')
  const width = 1600
  const height = 1000
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      rgba[offset] = x % 256
      rgba[offset + 1] = y % 256
      rgba[offset + 2] = (x + y) % 256
      rgba[offset + 3] = 255
    }
  }
  // Synthetic PNGs exercise presentation only, not native capture or Windows DPI.
  const capture = await captureAndSave({
    outputRoot,
    regions: [{ id: 7, x: 20, y: 30, width: 320, height: 180 }],
    profile: { id: 1, name: 'Synthetic large image' },
    trigger: 'fixture',
    captureFrame: () => ({
      width,
      height,
      rgba,
      capturedAt: '2026-09-22T08:00:00.000Z',
      backend: 'fixture'
    })
  })
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
  await page.getByRole('tab', { name: 'Captures', exact: true }).click()
  await expect(page.getByTestId('history-image-dimensions')).toHaveText('1600 × 1000 image pixels')
  return { page, capture }
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

test('fits large history images and offers a keyboard-accessible intrinsic-size scrolling view', async () => {
  const { page, capture } = await launchWithLargeCapture()
  const image = page.getByTestId('history-image')
  const viewport = page.getByRole('region', { name: 'Capture image preview', exact: true })
  const fit = page.getByRole('button', { name: 'Fit', exact: true })
  const actual = page.getByRole('button', { name: '100%', exact: true })
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  const fitSize = await image.evaluate((element: HTMLImageElement) => ({
    natural: [element.naturalWidth, element.naturalHeight],
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    viewportWidth: element.parentElement!.clientWidth,
    viewportHeight: element.parentElement!.clientHeight
  }))
  expect(fitSize.natural).toEqual([1600, 1000])
  expect(fitSize.width).toBeLessThan(1600)
  expect(fitSize.width).toBeLessThanOrEqual(fitSize.viewportWidth)
  expect(fitSize.height).toBeLessThanOrEqual(fitSize.viewportHeight + 1)
  expect(fitSize.width / fitSize.height).toBeCloseTo(1.6, 2)

  await actual.focus()
  await actual.press('Enter')
  await expect(actual).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByText(/100%: Original image size. Scroll to inspect the image./)
  ).toBeVisible()
  expect(
    await image.evaluate((element) => [
      element.getBoundingClientRect().width,
      element.getBoundingClientRect().height
    ])
  ).toEqual([1600, 1000])
  const overflow = await viewport.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight
  }))
  expect(overflow).toEqual({ horizontal: true, vertical: true })
  await viewport.focus()
  await viewport.press('ArrowRight')
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await viewport.press('ArrowDown')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('history-100-percent.png') })
  const original = await readFile(capture.originalPath!)
  expect(await image.getAttribute('src')).toBe(
    `data:image/png;base64,${original.toString('base64')}`
  )

  await page.getByLabel('Capture image', { exact: true }).selectOption('7')
  await expect(page.getByTestId('history-image-dimensions')).toHaveText('320 × 180 image pixels')
  await expect(actual).toHaveAttribute('aria-pressed', 'true')
  expect(
    await image.evaluate((element) => [
      element.getBoundingClientRect().width,
      element.getBoundingClientRect().height
    ])
  ).toEqual([320, 180])
  expect(await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([
    0, 0
  ])
  await page.getByLabel('Capture image', { exact: true }).selectOption('original')
  await expect(page.getByTestId('history-image-dimensions')).toHaveText('1600 × 1000 image pixels')
  expect(await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([
    0, 0
  ])
  await fit.focus()
  await fit.press('Space')
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  expect((await image.boundingBox())!.width).toBeLessThan(1600)
})

test('never relabels an old image and ignores a delayed result after a newer image loads', async () => {
  const { page, capture } = await launchWithLargeCapture()
  const urls = {
    original: `data:image/png;base64,${(await readFile(capture.originalPath!)).toString('base64')}`,
    roi: `data:image/png;base64,${(await readFile(capture.regions[0].path)).toString('base64')}`
  }
  // Delay only this test's image responses in Electron main. The first load above
  // and the other test use the production handler and actual synthetic PNG files.
  await application!.evaluate(
    ({ ipcMain }, { channel, images }) => {
      const pending = new Map<string, () => void>()
      Reflect.set(globalThis, 'historyPreviewPending', pending)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, _eventId, regionId) => {
        return new Promise<string>((complete) => {
          pending.set(String(regionId), () =>
            complete(regionId === null ? images.original : images.roi)
          )
        })
      })
    },
    { channel: IPC.readCaptureImage, images: urls }
  )
  await page.evaluate(() => {
    const relabelled: string[] = []
    Reflect.set(window, 'historyPreviewRelabelled', relabelled)
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof HTMLImageElement && record.attributeName === 'alt')
          relabelled.push(record.target.alt)
      }
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['alt'] })
  })

  await page.getByLabel('Capture image', { exact: true }).selectOption('7')
  await expect
    .poll(() =>
      application!.evaluate(() => Reflect.get(globalThis, 'historyPreviewPending').has('7'))
    )
    .toBe(true)
  await expect(page.getByTestId('history-image')).toHaveCount(0)
  await expect(page.getByTestId('history-image-dimensions')).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'historyPreviewRelabelled'))).toEqual([])

  await page.getByLabel('Capture image', { exact: true }).selectOption('original')
  await expect
    .poll(() =>
      application!.evaluate(() => Reflect.get(globalThis, 'historyPreviewPending').has('null'))
    )
    .toBe(true)
  await application!.evaluate(() => Reflect.get(globalThis, 'historyPreviewPending').get('null')())
  await expect(page.getByTestId('history-image')).toHaveAttribute('src', urls.original)
  await application!.evaluate(() => Reflect.get(globalThis, 'historyPreviewPending').get('7')())
  // Let the delayed IPC result and React's next paint settle without a timed sleep.
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  )
  await expect(page.getByTestId('history-image')).toHaveAttribute('src', urls.original)
  await expect(page.getByTestId('history-image')).toHaveAttribute('alt', 'Original capture')
  await expect(page.getByTestId('history-image-dimensions')).toHaveText('1600 × 1000 image pixels')
})
