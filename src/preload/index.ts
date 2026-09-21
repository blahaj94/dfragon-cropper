import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SpikeApi, type SpikeState } from '../shared/contracts'

const api: SpikeApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  captureNow: () => ipcRenderer.invoke(IPC.captureNow),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SpikeState) => callback(state)
    ipcRenderer.on(IPC.state, listener)
    return () => ipcRenderer.removeListener(IPC.state, listener)
  }
}

contextBridge.exposeInMainWorld('spike', api)
