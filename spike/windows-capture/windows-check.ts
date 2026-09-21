// Run in an interactive Windows desktop: npm run spike:pixels -- --scale=1.5
// This draws a deterministic borderless primary-monitor window, then checks real GDI pixels.
import { app, screen } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { release } from 'node:os'
import koffi from 'koffi'
import { PNG } from 'pngjs'
import { captureAndSave, capturePrimaryFrame } from '../../src/main/capture'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function argument(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

app.whenReady().then(async () => {
  const reportPath = resolve(
    argument('--output') ||
      join(process.env.DFRAGON_OUTPUT_DIR || '.dev-captures/pixel-check', 'report.json')
  )
  const output = dirname(reportPath)
  const requestedScale = argument('--scale')
  const expectedScale = requestedScale === undefined ? undefined : Number(requestedScale)
  const report: Record<string, unknown> = {
    platform: process.platform,
    osRelease: release(),
    electron: process.versions.electron,
    expectedScale: expectedScale ?? null,
    verified: false
  }
  let cleanup = () => {}
  try {
    if (process.platform !== 'win32') throw new Error('An interactive Windows desktop is required')
    if (expectedScale !== undefined && (!Number.isFinite(expectedScale) || expectedScale <= 0)) {
      throw new Error('--scale must be a positive number, such as 1 or 1.5')
    }
    const primary = screen.getPrimaryDisplay()
    Object.assign(report, { scaleFactor: primary.scaleFactor, dipSize: primary.size })
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    const dwm = koffi.load('dwmapi.dll')
    const setDpi = user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t)')
    const getSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int)')
    const createWindow = user32.func(
      'void * __stdcall CreateWindowExW(uint32_t, str16, str16, uint32_t, int, int, int, int, void *, void *, void *, void *)'
    )
    const destroyWindow = user32.func('int __stdcall DestroyWindow(void *)')
    const updateWindow = user32.func('int __stdcall UpdateWindow(void *)')
    const getDC = user32.func('void * __stdcall GetDC(void *)')
    const releaseDC = user32.func('int __stdcall ReleaseDC(void *, void *)')
    const getForeground = user32.func('void * __stdcall GetForegroundWindow()')
    const setForeground = user32.func('int __stdcall SetForegroundWindow(void *)')
    const getDpi = user32.func('uint32_t __stdcall GetDpiForWindow(void *)')
    // Explicit physical APIs also restore correctly after leaving this thread DPI scope.
    const setCursor = user32.func('int __stdcall SetPhysicalCursorPos(int, int)')
    const getCursor = user32.func('int __stdcall GetPhysicalCursorPos(_Out_ void *)')
    const getCursorInfo = user32.func('int __stdcall GetCursorInfo(_Inout_ void *)')
    const blit = gdi32.func(
      'int __stdcall SetDIBitsToDevice(void *, int, int, uint32_t, uint32_t, int, int, uint32_t, uint32_t, const void *, const void *, uint32_t)'
    )
    const flush = dwm.func('int32_t __stdcall DwmFlush()')
    const gdiFlush = gdi32.func('int __stdcall GdiFlush()')
    const previousDpi = setDpi(-3)
    if (!previousDpi) throw new Error('Could not enter physical-pixel DPI context')
    // Native primary metrics avoid off-by-one rounding from Electron DIP size × scale.
    const width = getSystemMetrics(0) as number
    const height = getSystemMetrics(1) as number
    const oldCursor = Buffer.alloc(8)
    if (!getCursor(oldCursor)) {
      setDpi(previousDpi)
      throw new Error('Could not remember cursor position')
    }
    let hwnd: unknown = null
    const previousForeground = getForeground()
    cleanup = () => {
      const destroyed = !hwnd || !!destroyWindow(hwnd)
      const restored = !!setCursor(oldCursor.readInt32LE(0), oldCursor.readInt32LE(4))
      if (previousForeground) setForeground(previousForeground)
      report.cleanupCompleted = destroyed && restored
      if (!report.cleanupCompleted) report.verified = false
    }
    try {
      if (width < 144 || height < 120) throw new Error('Primary display is too small for test ROIs')
      hwnd = createWindow(
        8,
        'STATIC',
        'DFragonCropper pixel fixture',
        0x90000000,
        0,
        0,
        width,
        height,
        null,
        null,
        null,
        null
      )
      if (!hwnd) throw new Error('Could not create native pattern window')
    } finally {
      setDpi(previousDpi)
    }
    const fixtureWindowDpi = getDpi(hwnd) as number
    const nativeScaleFactor = fixtureWindowDpi / 96
    Object.assign(report, { fixtureWindowDpi, nativeScaleFactor, physicalSize: { width, height } })
    if (!fixtureWindowDpi || nativeScaleFactor !== primary.scaleFactor) {
      throw new Error('Native window DPI and Electron primary scale disagree')
    }
    if (expectedScale !== undefined && nativeScaleFactor !== expectedScale) {
      throw new Error(`Expected scale ${expectedScale}, actual ${nativeScaleFactor}`)
    }
    setForeground(hwnd)
    await sleep(300)
    updateWindow(hwnd)
    // Never hide the cursor. Move and settle it before drawing the static window's pattern.
    if (!setCursor(48, 48))
      throw new Error('Could not position physical cursor inside the test ROI')
    await sleep(200)
    const bitmap = Buffer.alloc(width * height * 4)
    const expected = Buffer.alloc(bitmap.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const r = x % 256
        const g = y % 256
        const b = (x * 3 + y * 5) % 256
        bitmap.set([b, g, r, 0], i)
        expected.set([r, g, b, 255], i)
      }
    }
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(width, 4)
    header.writeInt32LE(-height, 8)
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    const dpi = setDpi(-3)
    if (!dpi) throw new Error('Could not enter physical-pixel DPI context for painting')
    const dc = getDC(hwnd)
    try {
      if (!dc || blit(dc, 0, 0, width, height, 0, 0, 0, height, bitmap, header, 0) !== height) {
        throw new Error('Could not paint full physical-pixel pattern')
      }
      if (!gdiFlush()) throw new Error('Could not flush fixture GDI drawing')
    } finally {
      if (dc) releaseDC(hwnd, dc)
      setDpi(dpi)
    }
    if (flush() < 0) throw new Error('DwmFlush failed; fixture may not be on screen')
    const cursorEvidence = () => {
      // CURSORINFO = DWORD size + DWORD flags + HCURSOR + POINT, on x64/ARM64 and x86.
      const pointerBytes = koffi.sizeof('void *')
      const cursorInfo = Buffer.alloc(16 + pointerBytes)
      cursorInfo.writeUInt32LE(cursorInfo.length, 0)
      if (!getCursorInfo(cursorInfo)) throw new Error('GetCursorInfo failed')
      const flags = cursorInfo.readUInt32LE(4)
      const handle = pointerBytes === 8 ? cursorInfo.readBigUInt64LE(8) : cursorInfo.readUInt32LE(8)
      const position = Buffer.alloc(8)
      if (!getCursor(position)) throw new Error('GetPhysicalCursorPos failed')
      const x = position.readInt32LE(0)
      const y = position.readInt32LE(4)
      const visible = (flags & 1) !== 0 && (flags & 2) === 0 && !!handle
      if (!visible || x !== 48 || y !== 48) {
        throw new Error(
          'Cursor is not visibly at physical (48, 48); exclusion test is inconclusive'
        )
      }
      return { visible, flags, physicalPosition: { x, y } }
    }
    const regions = [
      { id: 1, x: 16, y: 24, width: 128, height: 96 },
      { id: 2, x: width - 129, y: height - 97, width: 127, height: 95 }
    ]
    let sourceCaptureCalls = 0
    // No async pause between painting and capture: STATIC could repaint after yielding.
    const result = await captureAndSave({
      outputRoot: output,
      regions,
      trigger: 'native-pixel-check',
      captureFrame: () => {
        report.cursorBeforeCapture = cursorEvidence()
        sourceCaptureCalls++
        const frame = capturePrimaryFrame()
        report.cursorAfterCapture = cursorEvidence()
        return frame
      }
    })
    const source = PNG.sync.read(await readFile(join(result.outputDirectory, 'original.png')))
    const exactSource =
      source.width === width && source.height === height && source.data.equals(expected)
    const roiChecks = []
    for (const region of result.regions) {
      const png = PNG.sync.read(await readFile(region.path))
      let exact = png.width === region.width && png.height === region.height
      for (let y = 0; exact && y < region.height; y++) {
        const offset = ((region.y + y) * width + region.x) * 4
        exact = png.data
          .subarray(y * region.width * 4, (y + 1) * region.width * 4)
          .equals(expected.subarray(offset, offset + region.width * 4))
      }
      roiChecks.push({ id: region.id, exact })
    }
    Object.assign(report, {
      scaleFactor: primary.scaleFactor,
      fixtureWindowDpi: getDpi(hwnd),
      dipSize: primary.size,
      physicalSize: { width, height },
      capturedSize: { width: source.width, height: source.height },
      cursorVisibleOverRoi: true,
      sourceCaptureCalls,
      exactSource,
      roiChecks,
      eventId: result.eventId,
      verified: exactSource && sourceCaptureCalls === 1 && roiChecks.every((roi) => roi.exact)
    })
    if (!report.verified)
      throw new Error('Captured pixels do not exactly equal the physical pattern')
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      cleanup()
    } catch (error) {
      report.cleanupError = error instanceof Error ? error.message : String(error)
      report.verified = false
    }
    await mkdir(output, { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    app.exit(report.verified ? 0 : 1)
  }
})
