import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SpikeApi, type SpikeState } from '../shared/contracts'

const api: SpikeApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  captureNow: () => ipcRenderer.invoke(IPC.captureNow),
  updateProfiles: (command) => ipcRenderer.invoke(IPC.updateProfiles, command),
  previewScreen: () => ipcRenderer.invoke(IPC.previewScreen),
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

contextBridge.exposeInMainWorld('spike', api)
