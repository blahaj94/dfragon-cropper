import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RoiOverlayApi, type SpikeApi, type SpikeState } from '../shared/contracts'

const api: SpikeApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  captureNow: () => ipcRenderer.invoke(IPC.captureNow),
  updateProfiles: (command) => ipcRenderer.invoke(IPC.updateProfiles, command),
  selectRoi: () => ipcRenderer.invoke(IPC.selectRoi),
  onSelectRoiRequested: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC.selectRoiRequested, listener)
    return () => ipcRenderer.removeListener(IPC.selectRoiRequested, listener)
  },
  listCaptures: () => ipcRenderer.invoke(IPC.listCaptures),
  readCaptureImage: (eventId, regionId) =>
    ipcRenderer.invoke(IPC.readCaptureImage, eventId, regionId),
  openCaptureFolder: (eventId) => ipcRenderer.invoke(IPC.openCaptureFolder, eventId),
  minimizeToTray: () => ipcRenderer.invoke(IPC.minimizeToTray),
  quit: () => ipcRenderer.invoke(IPC.quit),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SpikeState) => callback(state)
    ipcRenderer.on(IPC.state, listener)
    return () => ipcRenderer.removeListener(IPC.state, listener)
  }
}

// The main process chooses the preload surface. The fragment alone never grants
// overlay privileges; every invocation also checks the exact live window in main.
if (process.argv.includes('--dfragon-roi-overlay')) {
  const overlayApi: RoiOverlayApi = {
    getFrame: () => ipcRenderer.invoke(IPC.overlayFrame),
    finish: (rectangle) => ipcRenderer.invoke(IPC.overlayFinish, rectangle)
  }
  contextBridge.exposeInMainWorld('roiOverlay', overlayApi)
} else {
  contextBridge.exposeInMainWorld('spike', api)
}
