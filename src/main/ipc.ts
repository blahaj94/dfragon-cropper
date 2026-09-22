import { ipcMain, type BrowserWindow } from 'electron'
import { IPC, type SpikeApi } from '../shared/contracts'
import type { PendingOperations } from './operations'
import { isWindowRequest } from './window-security'

type MainActions = Pick<
  SpikeApi,
  'getState' | 'captureNow' | 'selectRoi' | 'minimizeToTray' | 'quit'
> & {
  updateProfiles(command: unknown): ReturnType<SpikeApi['updateProfiles']>
  listCaptures(): ReturnType<SpikeApi['listCaptures']>
  readCaptureImage(eventId: unknown, regionId: unknown): ReturnType<SpikeApi['readCaptureImage']>
  openCaptureFolder(eventId: unknown): ReturnType<SpikeApi['openCaptureFolder']>
  listGroundTruthCaptures(cursor: unknown): ReturnType<SpikeApi['listGroundTruthCaptures']>
  readGroundTruthCapture(captureKey: unknown): ReturnType<SpikeApi['readGroundTruthCapture']>
  readGroundTruthImage(
    captureKey: unknown,
    regionId: unknown
  ): ReturnType<SpikeApi['readGroundTruthImage']>
  saveGroundTruth(command: unknown): ReturnType<SpikeApi['saveGroundTruth']>
}

/** IPC only checks transport identity/arity and delegates all domain work. */
export function installMainIpc(options: {
  window(): BrowserWindow | undefined
  documentUrl: string
  isShuttingDown(): boolean
  operations: PendingOperations
  actions: MainActions
}): void {
  const { actions } = options
  const handle = (
    channel: string,
    argumentCount: number,
    action: (...args: unknown[]) => Promise<unknown>
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      const window = options.window()
      if (
        options.isShuttingDown() ||
        args.length !== argumentCount ||
        !window ||
        !isWindowRequest(event, window, options.documentUrl)
      )
        throw new Error('Untrusted or unavailable IPC request')
      return options.operations.track(action(...args))
    })
  }
  handle(IPC.getState, 0, actions.getState)
  handle(IPC.captureNow, 0, actions.captureNow)
  handle(IPC.updateProfiles, 1, actions.updateProfiles)
  handle(IPC.selectRoi, 0, actions.selectRoi)
  handle(IPC.listCaptures, 0, actions.listCaptures)
  handle(IPC.readCaptureImage, 2, actions.readCaptureImage)
  handle(IPC.openCaptureFolder, 1, actions.openCaptureFolder)
  handle(IPC.listGroundTruthCaptures, 1, actions.listGroundTruthCaptures)
  handle(IPC.readGroundTruthCapture, 1, actions.readGroundTruthCapture)
  handle(IPC.readGroundTruthImage, 2, actions.readGroundTruthImage)
  handle(IPC.saveGroundTruth, 1, actions.saveGroundTruth)
  handle(IPC.minimizeToTray, 0, actions.minimizeToTray)
  handle(IPC.quit, 0, actions.quit)
}
