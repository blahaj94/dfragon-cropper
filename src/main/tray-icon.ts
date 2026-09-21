import { nativeImage } from 'electron'
import { PNG } from 'pngjs'

export function trayIcon() {
  const png = new PNG({ width: 32, height: 32 })
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const edge =
        (((x >= 7 && x <= 9) || (x >= 22 && x <= 24)) && y >= 4 && y <= 27) ||
        (((y >= 7 && y <= 9) || (y >= 22 && y <= 24)) && x >= 4 && x <= 27)
      png.data.set(edge ? [255, 255, 255, 255] : [32, 91, 205, 255], (y * 32 + x) * 4)
    }
  }
  return nativeImage.createFromBuffer(PNG.sync.write(png))
}
