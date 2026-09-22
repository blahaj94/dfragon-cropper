import { expect, type ElectronApplication, type Page } from '@playwright/test'

export async function openRoiOverlay(application: ElectronApplication, page: Page, f12 = false) {
  const opened = application.waitForEvent('window')
  if (f12) {
    // CDP keyboard events bypass Electron's before-input-event on this host.
    // Electron-generated input exercises that path, but is still synthetic input.
    await application.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().endsWith('#roi-overlay')
      )!
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F12' })
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F12' })
    })
  } else await page.getByRole('button', { name: 'Select ROI (F12)', exact: true }).click()
  const overlay = await opened
  await expect(overlay.getByTestId('roi-overlay-image')).toBeVisible()
  await expect
    .poll(() =>
      overlay
        .getByTestId('roi-overlay-image')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
    )
    .toBe(true)
  // Renderer DOM can be ready before loadURL's main-process continuation shows
  // the native window. Wait for presentation before testing or dragging it.
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => {
        const selection = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith('#roi-overlay')
        )
        return !!selection?.isVisible() && selection.isFocused()
      })
    )
    .toBe(true)
  return overlay
}

export async function dragRoi(
  overlay: Page,
  start = { x: 10.5, y: 20.5 },
  end = { x: 60.5, y: 60.5 },
  release = true
) {
  const image = overlay.getByTestId('roi-overlay-image')
  const size = await image.evaluate((element: HTMLImageElement) => ({
    width: element.naturalWidth,
    height: element.naturalHeight
  }))
  const bounds = (await image.boundingBox())!
  await overlay.mouse.move(
    bounds.x + (bounds.width * start.x) / size.width,
    bounds.y + (bounds.height * start.y) / size.height
  )
  await overlay.mouse.down()
  await overlay.mouse.move(
    bounds.x + (bounds.width * end.x) / size.width,
    bounds.y + (bounds.height * end.y) / size.height,
    { steps: 4 }
  )
  if (release) {
    const closed = overlay.waitForEvent('close')
    await overlay.mouse.up()
    await closed
  }
}
