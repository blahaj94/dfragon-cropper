import { PNG } from 'pngjs'

export interface PixelFrame {
  width: number
  height: number
  /** Top-down, tightly packed RGBA; native desktop alpha is always opaque. */
  rgba: Buffer
  capturedAt: string
  backend: 'win32-gdi' | 'fixture'
  deviceName?: string
}

export interface CaptureRegion {
  id: number
  x: number
  y: number
  width: number
  height: number
}

export function validateFrame(frame: PixelFrame): void {
  const { width, height, rgba } = frame
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height * 4) ||
    !Buffer.isBuffer(rgba) ||
    rgba.length !== width * height * 4
  ) {
    throw new Error('Source frame must contain exactly width × height physical RGBA pixels.')
  }
  if (!Number.isFinite(Date.parse(frame.capturedAt))) {
    throw new Error('Source frame must have a valid capture timestamp.')
  }
}

/** Reject bad coordinates instead of rounding, scaling, clipping, or silently renumbering IDs. */
export function validateRegions(
  regions: readonly CaptureRegion[],
  frame?: Pick<PixelFrame, 'width' | 'height'>
): void {
  const ids = new Set<number>()
  for (const region of regions) {
    if (!Number.isSafeInteger(region.id) || region.id <= 0 || ids.has(region.id)) {
      throw new Error('ROI IDs must be unique positive integers.')
    }
    ids.add(region.id)
    if (
      !Number.isSafeInteger(region.x) ||
      !Number.isSafeInteger(region.y) ||
      !Number.isSafeInteger(region.width) ||
      !Number.isSafeInteger(region.height) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0
    ) {
      throw new Error(
        `ROI ${region.id} requires nonnegative integer coordinates and positive integer dimensions.`
      )
    }
    if (
      frame &&
      (region.x + region.width > frame.width || region.y + region.height > frame.height)
    ) {
      throw new Error(
        `ROI ${region.id} is outside the ${frame.width} × ${frame.height} source frame.`
      )
    }
  }
}

export function cropFrame(frame: PixelFrame, region: CaptureRegion): PixelFrame {
  validateFrame(frame)
  validateRegions([region], frame)
  const rgba = Buffer.allocUnsafe(region.width * region.height * 4)
  const rowBytes = region.width * 4
  for (let row = 0; row < region.height; row += 1) {
    const sourceOffset = ((region.y + row) * frame.width + region.x) * 4
    frame.rgba.copy(rgba, row * rowBytes, sourceOffset, sourceOffset + rowBytes)
  }
  return { ...frame, width: region.width, height: region.height, rgba }
}

/** 32-bit BI_RGB DIBs contain BGRX, not valid alpha. No pixel value is filtered or rescaled. */
export function bgrxToRgba(bgrx: Uint8Array): Buffer {
  if (bgrx.length % 4 !== 0) throw new Error('BGRX data must contain whole 32-bit pixels.')
  const rgba = Buffer.allocUnsafe(bgrx.length)
  for (let offset = 0; offset < bgrx.length; offset += 4) {
    rgba[offset] = bgrx[offset + 2]
    rgba[offset + 1] = bgrx[offset + 1]
    rgba[offset + 2] = bgrx[offset]
    rgba[offset + 3] = 255
  }
  return rgba
}

export function encodeFramePng(frame: PixelFrame): Buffer {
  validateFrame(frame)
  const png = new PNG()
  png.width = frame.width
  png.height = frame.height
  png.data = frame.rgba
  return PNG.sync.write(png, {
    bitDepth: 8,
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true
  })
}
