import type { SpikeState } from '../../shared/contracts'
import type { createLogger } from '../logging'
import { captureAndSave, type CaptureTrigger, type Frame } from './index'

export function createCaptureController(options: {
  state: SpikeState
  outputRoot: string
  captureFrame: () => Frame
  logger: Pick<ReturnType<typeof createLogger>, 'write'>
  publish(): void
  isShuttingDown(): boolean
}) {
  const { state, logger, publish } = options
  return async (trigger: CaptureTrigger): Promise<SpikeState> => {
    if (options.isShuttingDown()) return state
    if (state.busy) {
      state.skipped++
      publish()
      return state
    }
    if (state.mode === 'unsupported') return state
    const activeProfile = state.settings?.profiles.find(
      (profile) => profile.id === state.settings?.activeProfileId
    )
    if (state.settingsError || !activeProfile?.regions.length) {
      state.error = state.settingsError || 'Select an active profile with at least one saved ROI.'
      publish()
      return state
    }
    state.busy = true
    state.error = null
    publish()
    try {
      state.lastCapture = await captureAndSave({
        outputRoot: options.outputRoot,
        trigger,
        profile: { id: activeProfile.id, name: activeProfile.name },
        regions: activeProfile.regions,
        saveOriginal: state.settings?.preferences.saveOriginal ?? true,
        captureFrame: options.captureFrame
      })
      state.completed++
      logger.write('capture.saved', {
        eventId: state.lastCapture.eventId,
        trigger,
        profileId: activeProfile.id
      })
    } catch (error) {
      state.failed++
      state.error = error instanceof Error ? error.message : String(error)
      logger.write('capture.failed', { trigger, error: state.error })
    } finally {
      state.busy = false
      publish()
    }
    return state
  }
}
