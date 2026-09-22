import type { RoiOverlayApi, SpikeApi } from '../../shared/contracts'

declare global {
  interface Window {
    spike: SpikeApi
    roiOverlay: RoiOverlayApi
  }
}
