import { createRequire } from 'node:module'
import { bgrxToRgba, type PixelFrame } from './pixels'

function loadWin32() {
  // Main is built as CommonJS. Keep koffi/native DLLs out of non-Windows UI and unit tests.
  const koffi = createRequire(__filename)('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const gdi32 = koffi.load('gdi32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  koffi.struct('DFC_CAPTURE_POINT', { x: 'int32_t', y: 'int32_t' })
  return {
    koffi,
    SetThreadDpiAwarenessContext: user32.func(
      'void * __stdcall SetThreadDpiAwarenessContext(void *context)'
    ),
    MonitorFromPoint: user32.func(
      'void * __stdcall MonitorFromPoint(DFC_CAPTURE_POINT point, uint32_t flags)'
    ),
    GetMonitorInfo: user32.func('int __stdcall GetMonitorInfoW(void *monitor, _Inout_ void *info)'),
    EnumDisplaySettings: user32.func(
      'int __stdcall EnumDisplaySettingsW(str16 device, uint32_t mode, _Inout_ void *settings)'
    ),
    CreateDC: gdi32.func(
      'void * __stdcall CreateDCW(str16 driver, str16 device, str16 port, const void *mode)'
    ),
    CreateCompatibleDC: gdi32.func('void * __stdcall CreateCompatibleDC(void *dc)'),
    CreateDIBSection: gdi32.func(
      'void * __stdcall CreateDIBSection(void *dc, const void *info, uint32_t usage, _Out_ void **bits, void *section, uint32_t offset)'
    ),
    SelectObject: gdi32.func('void * __stdcall SelectObject(void *dc, void *object)'),
    BitBlt: gdi32.func(
      'int __stdcall BitBlt(void *target, int x, int y, int width, int height, void *source, int sourceX, int sourceY, uint32_t operation)'
    ),
    GdiFlush: gdi32.func('int __stdcall GdiFlush()'),
    DeleteObject: gdi32.func('int __stdcall DeleteObject(void *object)'),
    DeleteDC: gdi32.func('int __stdcall DeleteDC(void *dc)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError()')
  }
}

let win32: ReturnType<typeof loadWin32> | undefined

/**
 * One synchronous GDI copy of only the primary display. No cursor is drawn into the DIB.
 * Windows 10 native evidence is still required; a macOS fixture cannot validate this backend.
 */
export function capturePrimaryFrame(): PixelFrame {
  if (process.platform !== 'win32') throw new Error('Desktop capture requires Windows 10.')
  const api = (win32 ??= loadWin32())
  const fail = (operation: string): Error =>
    new Error(`${operation} failed (Win32 ${api.GetLastError()}).`)

  // -3 is DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE (Windows 10 1607+).
  // This only prevents coordinate virtualization during this synchronous call; we never
  // enumerate/capture secondary displays or convert Electron DIP coordinates into ROI pixels.
  const previousDpi = api.SetThreadDpiAwarenessContext(-3n) as bigint | null
  if (!previousDpi) throw fail('SetThreadDpiAwarenessContext')
  let displayDC: bigint | null = null
  let memoryDC: bigint | null = null
  let bitmap: bigint | null = null
  let previousBitmap: bigint | null = null
  let frame: PixelFrame | undefined
  let captureError: unknown
  const cleanupErrors: Error[] = []
  try {
    const monitor = api.MonitorFromPoint({ x: 0, y: 0 }, 1) as bigint | null
    if (!monitor) throw fail('MonitorFromPoint')

    // MONITORINFOEXW: 40-byte MONITORINFO + WCHAR szDevice[32]. Fixed Win32 ABI.
    const monitorInfo = Buffer.alloc(104)
    monitorInfo.writeUInt32LE(monitorInfo.length, 0)
    if (!api.GetMonitorInfo(monitor, monitorInfo)) throw fail('GetMonitorInfoW')
    const left = monitorInfo.readInt32LE(4)
    const top = monitorInfo.readInt32LE(8)
    const width = monitorInfo.readInt32LE(12) - left
    const height = monitorInfo.readInt32LE(16) - top
    const primary = (monitorInfo.readUInt32LE(36) & 1) !== 0
    const deviceName = monitorInfo.toString('utf16le', 40, 104).split('\0')[0]
    if (!primary || left !== 0 || top !== 0 || width <= 0 || height <= 0 || !deviceName) {
      throw new Error('Expected the primary monitor at physical origin (0, 0).')
    }

    // EnumDisplaySettings is explicitly exempt from DPI virtualization. Cross-check its
    // physical dmPelsWidth/Height with the monitor rectangle; never silently apply a scale.
    // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumdisplaysettingsw
    const mode = Buffer.alloc(220) // sizeof(DEVMODEW), with no driver-private extra bytes.
    mode.writeUInt16LE(mode.length, 68) // dmSize
    if (!api.EnumDisplaySettings(deviceName, 0xffffffff, mode)) throw fail('EnumDisplaySettingsW')
    if (mode.readUInt32LE(172) !== width || mode.readUInt32LE(176) !== height) {
      throw new Error(
        'Primary monitor bounds do not match the physical display mode; capture aborted.'
      )
    }
    if (mode.readUInt32LE(168) !== 32) {
      throw new Error('The capture spike requires a 32-bit desktop display mode.')
    }

    displayDC = api.CreateDC(deviceName, deviceName, null, null) as bigint | null
    if (!displayDC) throw fail('CreateDCW')
    memoryDC = api.CreateCompatibleDC(displayDC) as bigint | null
    if (!memoryDC) throw fail('CreateCompatibleDC')

    // Negative biHeight creates a top-down DIB. 32 bpp has exactly width * 4 bytes/row.
    const bitmapInfo = Buffer.alloc(44) // BITMAPINFOHEADER + unused RGBQUAD
    bitmapInfo.writeUInt32LE(40, 0)
    bitmapInfo.writeInt32LE(width, 4)
    bitmapInfo.writeInt32LE(-height, 8)
    bitmapInfo.writeUInt16LE(1, 12) // planes
    bitmapInfo.writeUInt16LE(32, 14) // bit count; compression remains BI_RGB (0)
    const bits: (bigint | null)[] = [null]
    bitmap = api.CreateDIBSection(displayDC, bitmapInfo, 0, bits, null, 0) as bigint | null
    if (!bitmap || !bits[0]) throw fail('CreateDIBSection')
    previousBitmap = api.SelectObject(memoryDC, bitmap) as bigint | null
    if (!previousBitmap || previousBitmap === -1n || previousBitmap === 0xffffffffffffffffn) {
      previousBitmap = null
      throw fail('SelectObject')
    }

    const capturedAt = new Date().toISOString()
    // SRCCOPY | CAPTUREBLT | NOMIRRORBITMAP: copy layered windows without mirroring.
    // No StretchBlt, DrawIcon/DrawIconEx, resize, color management, or cursor composition.
    if (!api.BitBlt(memoryDC, 0, 0, width, height, displayDC, 0, 0, 0xc0cc0020)) {
      throw fail('BitBlt')
    }
    // CreateDIBSection requires GdiFlush before reading its memory after GDI draws.
    // https://learn.microsoft.com/windows/win32/api/wingdi/nf-wingdi-createdibsection
    if (!api.GdiFlush()) throw fail('GdiFlush')
    // decode copies into JS-owned memory. koffi.view is forbidden by Electron's V8 cage.
    const bgrx = api.koffi.decode(bits[0], 'uint8_t', width * height * 4) as Uint8Array
    frame = { width, height, rgba: bgrxToRgba(bgrx), capturedAt, backend: 'win32-gdi', deviceName }
  } catch (error) {
    captureError = error
  } finally {
    const clean = (operation: string, action: () => unknown): void => {
      try {
        if (!action()) cleanupErrors.push(fail(operation))
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (memoryDC && previousBitmap)
      clean('Restore selected bitmap', () => api.SelectObject(memoryDC, previousBitmap))
    // Delete the DC before the DIB even when restoring its selected object failed.
    if (memoryDC) clean('DeleteDC(memory)', () => api.DeleteDC(memoryDC))
    if (bitmap) clean('DeleteObject(bitmap)', () => api.DeleteObject(bitmap))
    if (displayDC) clean('DeleteDC(display)', () => api.DeleteDC(displayDC))
    clean('Restore thread DPI awareness', () => api.SetThreadDpiAwarenessContext(previousDpi))
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      captureError === undefined ? cleanupErrors : [captureError, ...cleanupErrors],
      'Windows capture resource cleanup failed.'
    )
  }
  if (!frame) throw captureError ?? new Error('Windows capture did not return a frame.')
  return frame
}
