import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PendingOperations } from '../../src/main/operations'
import { resolveRuntime } from '../../src/main/runtime'
import { isWindowRequest } from '../../src/main/window-security'

describe('application boundaries', () => {
  it('keeps development overrides out of packaged capture, settings and renderer paths', () => {
    const root = join(process.cwd(), 'portable-fixture')
    const runtime = resolveRuntime({
      packaged: true,
      appPath: join(root, 'app.asar'),
      bundleDirectory: join(root, 'out', 'main'),
      execPath: join(root, 'temporary-extraction', 'app.exe'),
      platform: 'win32',
      environment: {
        PORTABLE_EXECUTABLE_DIR: root,
        DFRAGON_FIXTURE: 'success',
        DFRAGON_TRIGGER: 'global-shortcut',
        DFRAGON_CONFIG_FILE: 'untrusted-config',
        DFRAGON_OUTPUT_DIR: 'untrusted-captures',
        DFRAGON_STATE_FILE: 'untrusted-state',
        DFRAGON_USER_DATA: 'untrusted-user-data',
        ELECTRON_RENDERER_URL: 'https://example.invalid/'
      }
    })
    expect(runtime.mode).toBe('keyboard-hook')
    expect(runtime.fixture).toBeUndefined()
    expect(runtime.stateFile).toBeUndefined()
    expect(runtime.userData).toBeUndefined()
    expect(runtime.configPath).toBe(join(root, 'config.json'))
    expect(runtime.captureRoots).toEqual([join(root, 'captures'), join(root, '.dev-captures')])
    expect(runtime.documentUrl).toMatch(/^file:/)
  })

  it('retains isolated fixture paths and the development renderer URL for UI verification', () => {
    const runtime = resolveRuntime({
      packaged: false,
      appPath: process.cwd(),
      bundleDirectory: join(process.cwd(), 'out', 'main'),
      execPath: process.execPath,
      platform: 'darwin',
      environment: {
        DFRAGON_FIXTURE: 'success',
        DFRAGON_CONFIG_FILE: 'fixture-config',
        DFRAGON_OUTPUT_DIR: 'fixture-captures',
        DFRAGON_USER_DATA: 'fixture-user-data',
        ELECTRON_RENDERER_URL: 'http://localhost:5173'
      }
    })
    expect(runtime.mode).toBe('fixture')
    expect(runtime.configPath).toBe('fixture-config')
    expect(runtime.captureRoots).toEqual(['fixture-captures'])
    expect(runtime.userData).toBe('fixture-user-data')
    expect(runtime.documentUrl).toBe('http://localhost:5173/')
  })

  it('only trusts the live window, its top frame and its exact document URL', () => {
    const url = 'file:///app/index.html'
    const frame = { url }
    const contents = { mainFrame: frame }
    let destroyed = false
    const window = {
      webContents: contents,
      isDestroyed: () => destroyed
    } as unknown as BrowserWindow
    const request = (sender = contents, senderFrame = frame) =>
      ({ sender, senderFrame }) as unknown as IpcMainInvokeEvent
    expect(isWindowRequest(request(), window, url)).toBe(true)
    expect(isWindowRequest(request({ mainFrame: frame }), window, url)).toBe(false)
    expect(isWindowRequest(request(contents, { url }), window, url)).toBe(false)
    frame.url = url + '#other-surface'
    expect(isWindowRequest(request(), window, url)).toBe(false)
    frame.url = url
    destroyed = true
    expect(isWindowRequest(request(), window, url)).toBe(false)
  })

  it('shutdown waits for outstanding writes even if another tracked operation rejects', async () => {
    const operations = new PendingOperations()
    let completeWrite!: () => void
    operations.track(new Promise<void>((resolve) => (completeWrite = resolve)))
    const failure = operations.track(Promise.reject(new Error('save failed')))
    await expect(failure).rejects.toThrow('save failed')
    let drained = false
    const shutdown = operations.drain().then(() => (drained = true))
    await Promise.resolve()
    expect(drained).toBe(false)
    completeWrite()
    await shutdown
    expect(drained).toBe(true)
  })
})
