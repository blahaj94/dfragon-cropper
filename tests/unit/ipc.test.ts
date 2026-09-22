import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/contracts'
import { installMainIpc } from '../../src/main/ipc'
import { PendingOperations } from '../../src/main/operations'

const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ) => handlers.set(channel, handler)
  }
}))

function fixture() {
  const frame = { url: 'file:///capture-app/index.html' }
  const contents = { mainFrame: frame }
  const window = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const operations = new PendingOperations()
  const actionNames = [
    'getState',
    'captureNow',
    'updateProfiles',
    'selectRoi',
    'listCaptures',
    'readCaptureImage',
    'openCaptureFolder',
    'listGroundTruthCaptures',
    'readGroundTruthCapture',
    'readGroundTruthImage',
    'saveGroundTruth',
    'minimizeToTray',
    'quit'
  ] as const
  const spies = Object.fromEntries(
    actionNames.map((name) => [name, vi.fn().mockResolvedValue(null)])
  )
  let shuttingDown = false
  installMainIpc({
    window: () => window,
    documentUrl: frame.url,
    isShuttingDown: () => shuttingDown,
    operations,
    actions: spies as unknown as Parameters<typeof installMainIpc>[0]['actions']
  })
  return { event, spies, operations, stop: () => (shuttingDown = true) }
}

describe('ground truth IPC boundary', () => {
  beforeEach(() => handlers.clear())

  it('checks window identity and exact argument counts before calling ground truth domains', async () => {
    const { event, spies, stop } = fixture()
    const calls = [
      ['listGroundTruthCaptures', [null]],
      ['readGroundTruthCapture', ['capture-key']],
      ['readGroundTruthImage', ['capture-key', 1]],
      [
        'saveGroundTruth',
        [{ captureKey: 'capture-key', regionId: 1, text: '닉네임', revision: 'r' }]
      ]
    ] as const
    for (const [name, args] of calls) {
      const invoke = handlers.get(IPC[name])!
      expect(() => invoke(event, ...args, 'extra')).toThrow('Untrusted')
      expect(() => invoke(event, ...args.slice(0, -1))).toThrow('Untrusted')
      expect(() =>
        invoke(
          {
            ...event,
            senderFrame: { url: 'file:///capture-app/index.html' }
          } as IpcMainInvokeEvent,
          ...args
        )
      ).toThrow('Untrusted')
      expect(spies[name]).not.toHaveBeenCalled()
      await invoke(event, ...args)
      expect(spies[name]).toHaveBeenCalledExactlyOnceWith(...args)
    }
    stop()
    expect(() => handlers.get(IPC.saveGroundTruth)!(event, {})).toThrow('Untrusted')
    expect(spies.saveGroundTruth).toHaveBeenCalledTimes(1)
  })

  it('waits for an accepted answer save before quitting', async () => {
    const { event, spies, operations } = fixture()
    let finish!: () => void
    spies.saveGroundTruth.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    const saving = handlers.get(IPC.saveGroundTruth)!(event, {})
    let finished = false
    const drain = operations.drain().then(() => (finished = true))
    await Promise.resolve()
    expect(finished).toBe(false)
    finish()
    await saving
    await drain
    expect(finished).toBe(true)
  })
})
