import type { SpikeApi } from '../../shared/contracts'

declare global {
  interface Window {
    spike: SpikeApi
  }
}
