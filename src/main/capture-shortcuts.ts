import { globalShortcut } from 'electron'
import type { SpikeState } from '../shared/contracts'
import { defaultShortcuts, formatShortcut, type ShortcutSettings } from '../shared/shortcuts'
import { startPrintScreenListener } from './printscreen'

/** Keep one native hook alive while it reads the latest successfully saved bindings. */
export function startCaptureShortcuts(options: {
  state: SpikeState
  capture(trigger: 'printscreen' | 'shortcut'): void
  selectRoi(): void
}): { nativeSelection: boolean; refresh(): void; stop(): void } {
  const { state } = options
  const defaults = defaultShortcuts()
  const saved = (): ShortcutSettings => state.settings?.shortcuts ?? defaults
  let stopListener = () => {}
  let nativeSelection = false
  let accelerator: string | null = null
  const capture = (key: number) => options.capture(key === 0x2c ? 'printscreen' : 'shortcut')
  if (state.mode === 'keyboard-hook') {
    try {
      const listener = startPrintScreenListener(capture, options.selectRoi, saved)
      stopListener = () => listener.stop()
      nativeSelection = true
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
    }
  }
  function refresh(): void {
    const bindings = saved()
    const captureLabel = formatShortcut(bindings.capture)
    const selectionLabel = formatShortcut(bindings.selectRoi)
    if (state.mode === 'keyboard-hook') {
      state.triggerStatus = nativeSelection
        ? `${captureLabel} listener active. Capture continues while the app is in the tray.`
        : 'Keyboard listener failed. Focus the app to use shortcuts, or use Capture Now.'
      state.selectionShortcutStatus = nativeSelection
        ? `${selectionLabel} selects an ROI, including while the app is in the tray.`
        : `Global selection is unavailable. Focus the app and press ${selectionLabel}, or use Select ROI.`
    } else if (state.mode === 'global-shortcut') {
      // Retained development experiment; normal builds use the pass-through hook.
      const next = captureLabel.replace('Win+', 'Super+').replace('Scroll Lock', 'ScrollLock')
      if (accelerator !== next) {
        if (accelerator) globalShortcut.unregister(accelerator)
        try {
          const registered = globalShortcut.register(next, () =>
            options.capture(bindings.capture.key === 'PrintScreen' ? 'printscreen' : 'shortcut')
          )
          accelerator = registered ? next : null
        } catch {
          accelerator = null
        }
      }
      state.triggerStatus = accelerator
        ? 'Electron globalShortcut registered. Default key behavior requires the Windows probe.'
        : 'Shortcut registration failed. Capture Now remains available.'
      state.selectionShortcutStatus = `${selectionLabel} selects an ROI while the app is focused.`
    } else if (state.mode === 'unsupported') {
      state.triggerStatus = 'Windows 10 is required for native capture.'
      state.selectionShortcutStatus = 'Screen selection requires Windows 10.'
    } else {
      state.selectionShortcutStatus = `${selectionLabel} selects an ROI while the app is focused.`
    }
  }
  refresh()
  return {
    nativeSelection,
    refresh,
    stop: () => {
      try {
        stopListener()
      } finally {
        globalShortcut.unregisterAll()
      }
    }
  }
}
