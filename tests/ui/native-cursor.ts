import type { ElectronApplication } from '@playwright/test'
import koffi from 'koffi'

type Point = { x: number; y: number }

/** Align native and CDP cursors for a screenshot of cursor-following UI, then restore it. */
export async function placeNativeCursor(application: ElectronApplication, position: Point) {
  const target = { x: Math.round(position.x), y: Math.round(position.y) }
  if (process.platform === 'darwin') {
    const original = await application.evaluate(({ screen }) => screen.getCursorScreenPoint())
    const library = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const point = koffi.struct({ x: 'double', y: 'double' })
    const warp = library.func('CGWarpMouseCursorPosition', 'int', [point])
    if (warp(target) !== 0)
      throw new Error('Could not position the native cursor for the UI fixture.')
    return () => {
      if (warp(original) !== 0)
        throw new Error('Could not restore the native cursor after the UI fixture.')
    }
  }
  if (process.platform === 'win32') {
    const physicalTarget = await application.evaluate(
      ({ screen }, next) => screen.dipToScreenPoint(next),
      target
    )
    const library = koffi.load('user32.dll')
    const point = koffi.struct({ x: 'int32_t', y: 'int32_t' })
    const getCursor = library.func('__stdcall', 'GetCursorPos', 'bool', [
      koffi.out(koffi.pointer(point))
    ])
    const setCursor = library.func('__stdcall', 'SetCursorPos', 'bool', ['int32_t', 'int32_t'])
    const awareness = library.func('void * __stdcall SetThreadDpiAwarenessContext(void *context)')
    const inPhysicalCoordinates = (run: () => void) => {
      const previous = awareness(-3n)
      if (!previous) throw new Error('Could not select physical cursor coordinates.')
      try {
        run()
      } finally {
        awareness(previous)
      }
    }
    const original = { x: 0, y: 0 }
    inPhysicalCoordinates(() => {
      if (!getCursor(original) || !setCursor(physicalTarget.x, physicalTarget.y))
        throw new Error('Could not position the native cursor for the UI fixture.')
    })
    return () =>
      inPhysicalCoordinates(() => {
        if (!setCursor(original.x, original.y))
          throw new Error('Could not restore the native cursor after the UI fixture.')
      })
  }
  throw new Error('The native cursor UI fixture supports macOS and Windows.')
}
