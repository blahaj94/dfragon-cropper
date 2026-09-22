import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { IPC } from '../../src/shared/contracts'
import { defaultShortcuts } from '../../src/shared/shortcuts'

let application: ElectronApplication | undefined
let temporaryDirectory: string | undefined

async function launchApp() {
  temporaryDirectory ??= await mkdtemp(join(tmpdir(), 'dfragon-shortcuts-ui-'))
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

const tab = (page: Page, name: 'Settings' | 'Profiles') =>
  page.getByRole('tab', { name, exact: true }).click()
const binding = (page: Page, name: 'Capture' | 'ROI selection') =>
  page.getByRole('group', { name, exact: true })

async function pressShortcut(
  keyCode: string,
  modifiers: ('control' | 'shift' | 'alt' | 'meta')[] = []
) {
  // Electron-generated events exercise the focused app adapter with synthetic
  // frames. They are not proof of the background Windows keyboard hook.
  await application!.evaluate(
    async ({ BrowserWindow }, input) => {
      const main = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().endsWith('#roi-overlay')
      )!
      main.focus()
      main.webContents.sendInputEvent({ type: 'keyDown', ...input })
      main.webContents.sendInputEvent({ type: 'keyUp', ...input })
      await new Promise((resolve) => setTimeout(resolve, 100))
    },
    { keyCode, modifiers }
  )
}

async function expectNoOverlay() {
  expect(
    await application!.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((window) =>
          window.webContents.getURL().endsWith('#roi-overlay')
        ).length
    )
  ).toBe(0)
}

async function selectAndCancel(key: string, modifiers: ('control' | 'shift')[] = []) {
  const opened = application!.waitForEvent('window')
  await pressShortcut(key, modifiers)
  const overlay = await opened
  await expect(overlay.getByTestId('roi-overlay-image')).toBeVisible()
  await expect
    .poll(() =>
      application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) =>
            window.webContents.getURL().endsWith('#roi-overlay') &&
            window.isVisible() &&
            window.isFocused()
        )
      )
    )
    .toBe(true)
  const closed = overlay.waitForEvent('close')
  await overlay.keyboard.down('Escape')
  await closed
}

test.afterEach(async () => {
  try {
    if (application && test.info().status !== test.info().expectedStatus) {
      for (const [index, page] of application.windows().entries()) {
        if (!page.isClosed())
          await page.screenshot({ path: test.info().outputPath(`shortcut-window-${index}.png`) })
      }
    }
  } finally {
    try {
      await application?.close()
    } finally {
      application = undefined
      if (temporaryDirectory)
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100
        })
      temporaryDirectory = undefined
    }
  }
})

test('saves both bindings explicitly, replaces focused shortcuts, persists and restores defaults', async () => {
  let page = await launchApp()
  await tab(page, 'Settings')
  await binding(page, 'Capture').getByRole('combobox').selectOption('F9')
  await binding(page, 'ROI selection').getByRole('combobox').selectOption('F8')
  await binding(page, 'ROI selection').getByLabel('Ctrl', { exact: true }).check()
  await binding(page, 'ROI selection').getByLabel('Shift', { exact: true }).check()
  await expect(page.getByTestId('saved-shortcuts')).toContainText(
    'Capture PrintScreen · ROI selection F12'
  )
  await tab(page, 'Profiles')
  await expect(page.getByRole('button', { name: 'Select ROI (F12)', exact: true })).toBeEnabled()
  await pressShortcut('F8', ['control', 'shift'])
  await expectNoOverlay()
  await selectAndCancel('F12')
  await tab(page, 'Settings')
  await expect(binding(page, 'Capture').getByRole('combobox')).toHaveValue('F9')
  await expect(binding(page, 'ROI selection').getByLabel('Ctrl', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click()
  await expect(page.getByText('Shortcuts saved.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('saved-shortcuts')).toContainText(
    'Capture F9 · ROI selection Ctrl+Shift+F8'
  )
  await page.screenshot({ path: test.info().outputPath('shortcut-settings.png'), fullPage: true })
  await tab(page, 'Profiles')
  await expect(
    page.getByRole('button', { name: 'Select ROI (Ctrl+Shift+F8)', exact: true })
  ).toBeEnabled()
  await pressShortcut('F12')
  await pressShortcut('F8', ['control'])
  await expectNoOverlay()
  await selectAndCancel('F8', ['control', 'shift'])
  await pressShortcut('F9')
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 1')
  await pressShortcut('PrintScreen')
  await pressShortcut('F9', ['shift'])
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 1')

  const saved = JSON.parse(await readFile(join(temporaryDirectory!, 'config.json'), 'utf8'))
  expect(saved.shortcuts.capture.key).toBe('F9')
  expect(saved.shortcuts.selectRoi).toEqual({
    key: 'F8',
    ctrl: true,
    alt: false,
    shift: true,
    meta: false
  })
  await application!.close()
  application = undefined
  page = await launchApp()
  await expect(
    page.getByRole('button', { name: 'Select ROI (Ctrl+Shift+F8)', exact: true })
  ).toBeEnabled()
  await tab(page, 'Settings')
  await expect(binding(page, 'Capture').getByRole('combobox')).toHaveValue('F9')
  await page.getByRole('button', { name: 'Restore default shortcuts', exact: true }).click()
  await expect(page.getByTestId('saved-shortcuts')).toContainText('Capture F9')
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click()
  await expect(page.getByText('Shortcuts saved.', { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.spike.getState())).settings!.shortcuts).toEqual(
    defaultShortcuts()
  )
  await tab(page, 'Profiles')
  await selectAndCancel('F12')
})

test('keeps rejected shortcut drafts across settings updates and discards without changing active keys', async () => {
  const page = await launchApp()
  await tab(page, 'Settings')
  await binding(page, 'Capture').getByRole('combobox').selectOption('F12')
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('different shortcuts')
  expect((await page.evaluate(() => window.spike.getState())).settings!.shortcuts).toEqual(
    defaultShortcuts()
  )
  await page.getByLabel('Save original PNG', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible()
  await expect(binding(page, 'Capture').getByRole('combobox')).toHaveValue('F12')
  await tab(page, 'Profiles')
  await tab(page, 'Settings')
  await expect(binding(page, 'Capture').getByRole('combobox')).toHaveValue('F12')
  await binding(page, 'Capture').getByRole('combobox').selectOption('KeyA')
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('letters and digits need Ctrl, Alt or Win')
  await page.getByRole('button', { name: 'Discard shortcut changes', exact: true }).click()
  await expect(binding(page, 'Capture').getByRole('combobox')).toHaveValue('PrintScreen')
  await expect(page.getByRole('alert')).toHaveCount(0)
  const persisted = JSON.parse(await readFile(join(temporaryDirectory!, 'config.json'), 'utf8'))
  expect(persisted.shortcuts).toEqual(defaultShortcuts())
  expect(persisted.preferences.saveOriginal).toBe(false)
})

test('blocks concurrent settings writes and preserves the draft and saved bindings after a transport failure', async () => {
  const page = await launchApp()
  const original = await readFile(join(temporaryDirectory!, 'config.json'), 'utf8')
  // A controlled IPC failure verifies pending/error UI. Persistence failures and
  // atomic writes have separate domain tests; this test never mutates the config.
  await application!.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(
      channel,
      () =>
        new Promise((_complete, fail) => {
          Reflect.set(globalThis, 'failShortcutSave', () =>
            fail(new Error('Fixture shortcut save failed'))
          )
        })
    )
  }, IPC.updateProfiles)
  await tab(page, 'Settings')
  await page.getByLabel('Save original PNG', { exact: true }).uncheck()
  await binding(page, 'Capture').getByRole('combobox').selectOption('F9')
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saving shortcuts…', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Save original PNG', { exact: true })).toBeDisabled()
  await tab(page, 'Profiles')
  await expect(page.getByLabel('Profile name', { exact: true })).toBeDisabled()
  await application!.evaluate(() => Reflect.get(globalThis, 'failShortcutSave')())
  await expect(page.getByLabel('Profile name', { exact: true })).toBeEnabled()
  await tab(page, 'Settings')
  await expect(page.getByRole('alert')).toContainText('Fixture shortcut save failed')
  await expect(binding(page, 'Capture').getByRole('combobox')).toHaveValue('F9')
  await expect(page.getByTestId('saved-shortcuts')).toContainText('Capture PrintScreen')
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled()
  expect(await readFile(join(temporaryDirectory!, 'config.json'), 'utf8')).toBe(original)
  await pressShortcut('PrintScreen')
  await expect(page.getByTestId('capture-counters')).toContainText('Completed: 1')
})
