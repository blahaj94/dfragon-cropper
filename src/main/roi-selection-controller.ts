import type { RoiSelection, SpikeState } from '../shared/contracts'
import { encodeFramePng, type Frame } from './capture'
import type { createLogger } from './logging'
import type { MainWindow } from './main-window'
import type { RoiSelectionWindow } from './roi-selection'

/** Own the capture-before-overlay workflow and restore the desktop after it settles. */
export function createRoiSelectionController(options: {
  state: SpikeState
  captureFrame(): Frame
  fixture: boolean
  mainWindow(): MainWindow | undefined
  selectionWindow(): RoiSelectionWindow | undefined
  logger: Pick<ReturnType<typeof createLogger>, 'write'>
  publish(): void
  isShuttingDown(): boolean
}) {
  const { state, publish } = options
  let active = false
  return {
    isActive: () => active,
    canRequest: () =>
      !options.isShuttingDown() &&
      !state.busy &&
      !state.settingsError &&
      !!state.settings?.profiles.length,
    async select(): Promise<RoiSelection | null> {
      if (options.isShuttingDown() || state.busy)
        throw new Error('Wait for the current operation to finish.')
      if (state.mode === 'unsupported') throw new Error('Screen selection requires Windows 10.')
      if (state.settingsError || !state.settings?.profiles.length)
        throw new Error(state.settingsError || 'Create a profile before selecting an ROI.')
      const selectionWindow = options.selectionWindow()
      const mainWindow = options.mainWindow()
      if (!selectionWindow || !mainWindow) throw new Error('Screen selection is not available.')
      state.busy = true
      publish()
      let result: RoiSelection | null = null
      active = true
      let presentation: ReturnType<MainWindow['hideTemporarily']> | undefined
      try {
        presentation = mainWindow.hideTemporarily()
        // Allow the compositor to remove the app before taking the one preview frame.
        if (presentation.wasVisible && !options.fixture)
          await new Promise((accept) => setTimeout(accept, 200))
        if (options.isShuttingDown()) return null
        const frame = options.captureFrame()
        result = await selectionWindow.open({
          width: frame.width,
          height: frame.height,
          capturedAt: frame.capturedAt,
          dataUrl: `data:image/png;base64,${encodeFramePng(frame).toString('base64')}`
        })
        return result
      } catch (error) {
        options.logger.write('roi.selection-failed', { error: String(error) })
        throw error
      } finally {
        active = false
        presentation?.restore(result !== null)
        state.busy = false
        publish()
      }
    }
  }
}
