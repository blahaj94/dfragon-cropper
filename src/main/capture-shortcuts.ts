import { globalShortcut } from 'electron'
import type { SpikeState } from '../shared/contracts'
import { startPrintScreenListener } from './printscreen'

/** Translate native registration results into app status; the hook itself stays independent. */
export function startCaptureShortcuts(options: {
  state: SpikeState
  capture(): void
  selectRoi(): void
}): { nativeSelection: boolean; stop(): void } {
  const { state } = options
  let stopListener = () => {}
  let nativeSelection = false
  if (state.mode === 'keyboard-hook') {
    try {
      const listener = startPrintScreenListener(options.capture, options.selectRoi)
      stopListener = () => listener.stop()
      nativeSelection = true
      state.selectionShortcutStatus = 'F12 selects an ROI, including while the app is in the tray.'
      state.triggerStatus =
        'PrintScreen listener active. Capture continues while the app is in the tray.'
    } catch (error) {
      state.triggerStatus = 'PrintScreen listener failed. Capture Now remains available.'
      state.selectionShortcutStatus =
        'Global F12 is unavailable. Focus the app and press F12, or use Select ROI (F12).'
      state.error = error instanceof Error ? error.message : String(error)
    }
  } else if (state.mode === 'global-shortcut') {
    const registered = globalShortcut.register('PrintScreen', options.capture)
    state.triggerStatus = registered
      ? 'Electron globalShortcut registered. Default PrintScreen behavior requires the Windows probe.'
      : 'PrintScreen registration failed. Capture Now remains available.'
  } else if (state.mode === 'unsupported') {
    state.triggerStatus = 'Windows 10 is required for native capture.'
    state.selectionShortcutStatus = 'Screen selection requires Windows 10.'
  }
  return {
    nativeSelection,
    stop: () => {
      try {
        stopListener()
      } finally {
        globalShortcut.unregisterAll()
      }
    }
  }
}
