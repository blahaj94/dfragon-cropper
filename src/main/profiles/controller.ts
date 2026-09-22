import type { SpikeState } from '../../shared/contracts'
import { loadProfileStore, ProfileFileConflictError, type ProfileStore } from './store'

interface ProfileControllerOptions {
  state: SpikeState
  configPath: string
  logger: { write(event: string, details?: Record<string, unknown>): void }
  publish(): void
  selectionActive(): boolean
}

/** Translate profile persistence outcomes into the app's saved settings and form errors. */
export function createProfileController({
  state,
  configPath,
  logger,
  publish,
  selectionActive
}: ProfileControllerOptions) {
  let store: ProfileStore | null = null
  return {
    async load(): Promise<void> {
      try {
        store = await loadProfileStore(configPath)
        state.settings = store.get()
      } catch (error) {
        state.settingsError = error instanceof Error ? error.message : String(error)
        logger.write('settings.load-failed', { error: state.settingsError })
      }
    },
    async update(command: unknown): Promise<SpikeState> {
      if (selectionActive())
        throw new Error('Finish or cancel screen selection before saving changes.')
      if (!store || state.settingsError)
        throw new Error(state.settingsError || 'Profiles are not available.')
      try {
        state.settings = await store.apply(command)
      } catch (error) {
        if (error instanceof ProfileFileConflictError) {
          state.settingsError = error.message
          publish()
        }
        logger.write('settings.save-failed', { error: String(error) })
        throw error
      }
      state.error = null
      publish()
      return state
    }
  }
}
