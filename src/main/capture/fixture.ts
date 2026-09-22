import type { PixelFrame } from './pixels'

/** Deterministic development source, injected by the composition root, never by IPC. */
export function createFixtureSource(mode: string): () => PixelFrame {
  return () => {
    if (mode === 'failure') throw new Error('Fixture capture failed')
    const width = 320
    const height = 240
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        rgba.set([x % 256, y % 256, (x + y) % 256, 255], (y * width + x) * 4)
      }
    }
    return { width, height, rgba, capturedAt: new Date().toISOString(), backend: 'fixture' }
  }
}
