import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import type { CaptureSummary } from '../../src/shared/contracts'
import { dragRoi, openRoiOverlay } from './roi-helpers'
import { placeNativeCursor } from './native-cursor'

let application: ElectronApplication | undefined
let temporaryDirectory: string | undefined

async function launchApp() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'dfragon-redraw-ui-'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  delete environment.DFRAGON_STATE_FILE
  application = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: {
      ...environment,
      DFRAGON_FIXTURE: 'success',
      DFRAGON_OUTPUT_DIR: join(temporaryDirectory, 'captures'),
      DFRAGON_USER_DATA: join(temporaryDirectory, 'user-data'),
      DFRAGON_CONFIG_FILE: join(temporaryDirectory, 'config.json')
    }
  })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: 'Capture Now', exact: true })).toBeEnabled()
  return page
}

async function capture(page: import('@playwright/test').Page, count: number) {
  await page.getByRole('button', { name: 'Capture Now', exact: true }).click()
  await expect(page.getByTestId('capture-counters')).toContainText(`Completed: ${count}`)
  return (await page.evaluate(() => window.spike.getState())).lastCapture!
}

async function expectExactPixels(capture: CaptureSummary) {
  const source = PNG.sync.read(await readFile(join(capture.outputDirectory, 'original.png')))
  for (const region of capture.regions) {
    const cropped = PNG.sync.read(await readFile(region.path))
    expect([cropped.width, cropped.height]).toEqual([region.width, region.height])
    for (let row = 0; row < region.height; row++) {
      const start = ((region.y + row) * source.width + region.x) * 4
      expect(cropped.data.subarray(row * region.width * 4, (row + 1) * region.width * 4)).toEqual(
        source.data.subarray(start, start + region.width * 4)
      )
    }
  }
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

test('selects an existing ROI on the frozen screen and changes capture pixels only after Save', async () => {
  const page = await launchApp()
  await page.getByLabel('New profile name', { exact: true }).fill('Redraw')
  await page.getByRole('button', { name: 'Create profile', exact: true }).click()
  await page
    .getByRole('group', { name: 'New ROI', exact: true })
    .getByRole('button', { name: 'Add ROI', exact: true })
    .click()
  const roi = page.getByRole('group', { name: 'ROI #1', exact: true })
  await page.getByRole('combobox', { name: 'Preview target', exact: true }).selectOption('1')
  const overlay = await openRoiOverlay(application!, page)
  await dragRoi(overlay, undefined, undefined, false)
  // Moving the pointer cannot mutate numeric drafts or saved capture settings.
  await expect(roi.getByLabel('X', { exact: true })).toHaveValue('0')
  const closed = overlay.waitForEvent('close')
  await overlay.mouse.up()
  await closed
  await expect(roi.getByLabel('X', { exact: true })).toHaveValue('10')
  await expect(roi.getByLabel('Y', { exact: true })).toHaveValue('20')
  await expect(roi.getByLabel('Width', { exact: true })).toHaveValue('51')
  await expect(roi.getByLabel('Height', { exact: true })).toHaveValue('41')
  const before = await capture(page, 1)
  expect(before.profile).toEqual({ id: 2, name: 'Redraw' })
  expect(before.regions).toHaveLength(1)
  expect(before.regions[0]).toMatchObject({ id: 1, x: 0, y: 0, width: 100, height: 100 })
  await expectExactPixels(before)
  await page.getByRole('button', { name: 'Save ROI #1', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.spike.getState())).settings!.profiles.find(
          (profile) => profile.id === 2
        )!.regions[0].x
    )
    .toBe(10)
  const after = await capture(page, 2)
  expect(after.regions).toHaveLength(1)
  expect(after.regions[0]).toMatchObject({ id: 1, x: 10, y: 20, width: 51, height: 41 })
  await expectExactPixels(after)
  const settings = (await page.evaluate(() => window.spike.getState())).settings!
  expect(settings.profiles.find((profile) => profile.id === 2)?.nextRegionId).toBe(2)
  const persisted = JSON.parse(await readFile(join(temporaryDirectory!, 'config.json'), 'utf8'))
  expect(persisted.profiles.find((profile: { id: number }) => profile.id === 2).regions).toEqual([
    { id: 1, x: 10, y: 20, width: 51, height: 41 }
  ])
})

test('Escape preserves invalid and completed drafts; tab/profile changes and discard retain saved coordinates', async () => {
  const page = await launchApp()
  await page.getByLabel('New profile name', { exact: true }).fill('Other')
  await page.getByRole('button', { name: 'Create profile', exact: true }).click()
  await page.getByLabel('Edit profile', { exact: true }).selectOption('1')
  const roi = page.getByRole('group', { name: 'ROI #1', exact: true })
  const saved = (await page.evaluate(() => window.spike.getState())).settings!.profiles[0]
    .regions[0]
  await page.getByRole('combobox', { name: 'Preview target', exact: true }).selectOption('1')
  await roi.getByLabel('X', { exact: true }).fill('19')
  await roi.getByLabel('Width', { exact: true }).fill('')
  await expect(page.getByTestId('preview-draft-error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save ROI #1', exact: true })).toBeDisabled()
  const overlay = await openRoiOverlay(application!, page)
  await dragRoi(overlay, undefined, undefined, false)
  const closed = overlay.waitForEvent('close')
  await overlay.keyboard.down('Escape')
  await closed
  await expect(roi.getByLabel('X', { exact: true })).toHaveValue('19')
  await expect(roi.getByLabel('Width', { exact: true })).toHaveValue('')
  await roi.getByLabel('Width', { exact: true }).fill(String(saved.width))
  await page.getByLabel('Edit profile', { exact: true }).selectOption('2')
  await page.getByLabel('Edit profile', { exact: true }).selectOption('1')
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Profiles', exact: true }).click()
  await expect(roi.getByLabel('X', { exact: true })).toHaveValue('19')
  await page.getByRole('button', { name: 'Discard ROI #1 changes', exact: true }).click()
  await expect(roi.getByLabel('X', { exact: true })).toHaveValue(String(saved.x))
  expect(
    (await page.evaluate(() => window.spike.getState())).settings!.profiles[0].regions[0]
  ).toEqual(saved)
})

test('keeps selections per profile and applies Edit drawn ROI to the chosen immutable ID', async () => {
  const page = await launchApp()
  await dragRoi(await openRoiOverlay(application!, page))
  await expect(page.getByTestId('drawn-rectangle')).toContainText(
    'X 10 · Y 20 · Width 51 · Height 41'
  )
  await page.getByLabel('New profile name', { exact: true }).fill('Other')
  await page.getByRole('button', { name: 'Create profile', exact: true }).click()
  await expect(page.getByLabel('Edit profile', { exact: true })).toHaveValue('2')
  await dragRoi(
    await openRoiOverlay(application!, page),
    { x: 100.5, y: 110.5 },
    { x: 70.5, y: 80.5 }
  )
  await expect(page.getByTestId('drawn-rectangle')).toContainText(
    'X 70 · Y 80 · Width 31 · Height 31'
  )
  await page.getByRole('button', { name: 'Add drawn ROI', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add drawn ROI', exact: true })).toBeDisabled()
  await page.getByLabel('Edit profile', { exact: true }).selectOption('1')
  await expect(page.getByTestId('drawn-rectangle')).toContainText(
    'X 10 · Y 20 · Width 51 · Height 41'
  )
  const before = (await page.evaluate(() => window.spike.getState())).settings!.profiles[0]
  await page.getByRole('combobox', { name: 'Replace existing ROI', exact: true }).selectOption('2')
  await page.getByRole('button', { name: 'Edit drawn ROI', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Preview target', exact: true })).toHaveValue('2')
  await expect(
    page.getByRole('group', { name: 'ROI #2', exact: true }).getByLabel('X', { exact: true })
  ).toHaveValue('10')
  expect((await page.evaluate(() => window.spike.getState())).settings!.profiles[0]).toEqual(before)
  await page.getByRole('button', { name: 'Save ROI #2', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.spike.getState())).settings!.profiles[0].regions[1].x
    )
    .toBe(10)
  const after = (await page.evaluate(() => window.spike.getState())).settings!.profiles[0]
  expect(after.nextRegionId).toBe(before.nextRegionId)
  expect(after.regions).toHaveLength(before.regions.length)
  expect(after.regions[0]).toEqual(before.regions[0])
  expect(after.regions[1]).toEqual({ id: 2, x: 10, y: 20, width: 51, height: 41 })
})

test('F12 opens a separate frozen full-screen overlay with a bounded magnifier and isolated IPC', async () => {
  const page = await launchApp()
  await page.getByRole('tab', { name: 'Captures', exact: true }).click()
  // Electron-generated input exercises the foreground F12 path, not a physical global key.
  const overlay = await openRoiOverlay(application!, page, true)
  const image = overlay.getByTestId('roi-overlay-image')
  const sourceUrl = await image.getAttribute('src')
  expect(PNG.sync.read(Buffer.from(sourceUrl!.split(',')[1], 'base64')).width).toBe(320)
  expect(
    await overlay.evaluate(() => ({
      require: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
      spike: typeof Reflect.get(window, 'spike'),
      methods: Object.keys(window.roiOverlay).sort()
    }))
  ).toEqual({
    require: 'undefined',
    process: 'undefined',
    spike: 'undefined',
    methods: ['finish', 'getFrame']
  })
  expect(await page.evaluate(() => typeof Reflect.get(window, 'roiOverlay'))).toBe('undefined')
  const windows = await application!.evaluate(({ BrowserWindow, screen }) => {
    const selection = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('#roi-overlay')
    )!
    return {
      bounds: selection.getBounds(),
      display: screen.getPrimaryDisplay().bounds,
      alwaysOnTop: selection.isAlwaysOnTop(),
      count: BrowserWindow.getAllWindows().length
    }
  })
  expect(windows.bounds).toEqual(windows.display)
  expect(windows.alwaysOnTop).toBe(true)
  expect(windows.count).toBe(2)
  await expect
    .poll(() =>
      application!.evaluate(({ BrowserWindow }) => {
        const overlayWindow = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith('#roi-overlay')
        )
        return !!overlayWindow?.isVisible() && overlayWindow.isFocused()
      })
    )
    .toBe(true)
  await overlay.waitForFunction(() => document.hasFocus())
  const bounds = (await image.boundingBox())!
  const restoreCursor = await placeNativeCursor(application!, {
    x: bounds.x + (bounds.width * 160.5) / 320,
    y: bounds.y + (bounds.height * 120.5) / 240
  })
  try {
    await overlay.mouse.move(
      bounds.x + (bounds.width * 160.5) / 320,
      bounds.y + (bounds.height * 120.5) / 240
    )
    const magnifier = overlay.getByTestId('roi-magnifier')
    await expect(magnifier).toBeVisible()
    await expect(magnifier).toHaveAttribute('data-source-x', '160')
    await expect(magnifier).toHaveAttribute('data-source-y', '120')
    const patch = overlay.getByTestId('roi-magnifier-pixels')
    await expect(patch.locator('img')).toHaveAttribute('src', sourceUrl!)
    await overlay.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )
    // Exercise a pointer-following repaint after the magnifier mounts. DOM visibility
    // alone can precede its composited pixels in a newly shown Electron fullscreen window.
    await overlay.mouse.move(
      bounds.x + (bounds.width * 170.5) / 320,
      bounds.y + (bounds.height * 120.5) / 240
    )
    await overlay.mouse.move(
      bounds.x + (bounds.width * 160.5) / 320,
      bounds.y + (bounds.height * 120.5) / 240
    )
    await expect(async () => {
      const patchBounds = (await patch.boundingBox())!
      expect([patchBounds.width, patchBounds.height]).toEqual([120, 120])
      const patchPixels = PNG.sync.read(
        await overlay.screenshot({
          scale: 'css',
          path: test.info().outputPath('roi-fullscreen-magnifier.png')
        })
      )
      // Eight display pixels from the crosshair samples the next source pixel.
      // Keep the exact assertion while waiting for the visible compositor frame.
      const sample = ((patchBounds.y + 68) * patchPixels.width + patchBounds.x + 68) * 4
      const rgba = [...patchPixels.data.subarray(sample, sample + 4)]
      expect(rgba).toEqual([161, 121, 26, 255])
    }).toPass({ timeout: 3000, intervals: [50, 100, 200] })
    const center = (await magnifier.boundingBox())!
    expect(center.x).toBeGreaterThan(bounds.x + bounds.width / 2)
    expect(center.y).toBeGreaterThan(bounds.y + bounds.height / 2)
    await overlay.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1)
    const edge = (await magnifier.boundingBox())!
    const viewport = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(edge.x).toBeGreaterThanOrEqual(0)
    expect(edge.y).toBeGreaterThanOrEqual(0)
    expect(edge.x + edge.width).toBeLessThanOrEqual(viewport.width)
    expect(edge.y + edge.height).toBeLessThanOrEqual(viewport.height)
    await expect(image).toHaveAttribute('src', sourceUrl!)
    const error = await overlay.evaluate(async () => {
      try {
        await window.roiOverlay.finish({ x: -1, y: 0, width: 10, height: 10 })
        return null
      } catch (reason) {
        return String(reason)
      }
    })
    expect(error).toBeTruthy()
    await expect(image).toBeVisible()
    await dragRoi(overlay)
    await expect(page.getByRole('tab', { name: 'Profiles', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByTestId('drawn-rectangle')).toContainText(
      'X 10 · Y 20 · Width 51 · Height 41'
    )
    const state = await page.evaluate(() => window.spike.getState())
    expect(state.completed).toBe(0)
    expect(state.busy).toBe(false)
  } finally {
    restoreCursor()
  }
})

test('quitting with an open selection closes it and does not wait forever for a rectangle', async () => {
  const page = await launchApp()
  await openRoiOverlay(application!, page)
  const closed = application!.waitForEvent('close', { timeout: 10_000 })
  await application!.evaluate(({ app }) => app.quit())
  await closed
  application = undefined
})
