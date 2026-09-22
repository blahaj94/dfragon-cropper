import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  callback: null as ((code: number, message: number, key: bigint | null) => number | bigint) | null,
  SetWindowsHookExW: vi.fn((): bigint | null => 1n),
  CallNextHookEx: vi.fn(() => 19n),
  UnhookWindowsHookEx: vi.fn(() => true),
  GetModuleHandleW: vi.fn(() => 1n),
  GetLastError: vi.fn(() => 5),
  GetAsyncKeyState: vi.fn<(key: number) => number>(() => 0),
  decode: vi.fn((key: bigint) => Number(key)),
  unregister: vi.fn()
}))

vi.mock('koffi', () => ({
  default: {
    load: () => ({
      func: (_callingConvention: string, name: string) => native[name as keyof typeof native]
    }),
    proto: () => 'hook-procedure',
    pointer: (value: unknown) => value,
    register: (callback: typeof native.callback) => {
      native.callback = callback
      return 1n
    },
    unregister: native.unregister,
    decode: { uint32: native.decode }
  }
}))

import { startPrintScreenListener, type PrintScreenListener } from '../../src/main/printscreen'
import { defaultShortcuts } from '../../src/shared/shortcuts'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
let listener: PrintScreenListener | undefined
const down = 0x0100
const up = 0x0101
const printScreen = 0x2cn
const f12 = 0x7bn
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  vi.clearAllMocks()
  native.SetWindowsHookExW.mockReturnValue(1n)
  native.UnhookWindowsHookEx.mockReturnValue(true)
  native.decode.mockImplementation((key) => Number(key))
  native.GetAsyncKeyState.mockReturnValue(0)
})

afterEach(() => {
  listener?.stop()
  listener = undefined
  Object.defineProperty(process, 'platform', platformDescriptor)
})

describe('pass-through keyboard hook with mocked Win32 calls', () => {
  it('keeps the one-callback PrintScreen API and defers deduplicated presses', async () => {
    const capture = vi.fn()
    listener = startPrintScreenListener(capture)
    expect(native.callback!(0, down, printScreen)).toBe(19n)
    native.callback!(0, down, printScreen)
    native.callback!(0, down, f12)
    expect(capture).not.toHaveBeenCalled()
    await flush()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenLastCalledWith(Number(printScreen))
    native.callback!(0, up, printScreen)
    native.callback!(0, down, printScreen)
    await flush()
    expect(capture).toHaveBeenCalledTimes(2)
    expect(native.CallNextHookEx).toHaveBeenCalledTimes(5)
  })

  it('consumes enabled F12 while independently tracking and forwarding PrintScreen', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    listener = startPrintScreenListener(capture, select)
    for (const [message, key] of [
      [down, printScreen],
      [down, f12],
      [down, f12],
      [up, f12],
      [0x0104, f12],
      [0x0105, f12],
      [down, printScreen]
    ] as const)
      expect(native.callback!(0, message, key)).toBe(key === f12 ? 1 : 19n)
    expect(capture).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    await flush()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(2)
    expect(native.CallNextHookEx).toHaveBeenCalledTimes(2)
    for (const call of native.CallNextHookEx.mock.calls)
      expect(call).toEqual([null, 0, down, printScreen])
  })

  it('forwards negative codes, unrelated keys and decoding failures without notifications', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    listener = startPrintScreenListener(capture, select)
    expect(native.callback!(-1, down, printScreen)).toBe(19n)
    expect(native.callback!(-1, down, f12)).toBe(19n)
    expect(native.callback!(0, down, null)).toBe(19n)
    expect(native.callback!(0, down, 0x41n)).toBe(19n)
    native.decode.mockImplementationOnce(() => {
      throw new Error('Decode failure')
    })
    expect(native.callback!(0, down, f12)).toBe(19n)
    await flush()
    expect(capture).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(native.CallNextHookEx).toHaveBeenCalledTimes(5)
  })

  it('uses newly saved bindings without reinstalling and forwards every capture key event', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    let shortcuts = defaultShortcuts()
    listener = startPrintScreenListener(capture, select, () => shortcuts)
    shortcuts = {
      capture: { key: 'KeyS', ctrl: true, alt: false, shift: true, meta: false },
      selectRoi: { key: 'F8', ctrl: false, alt: false, shift: false, meta: false }
    }
    // Old default keys pass through without firing either action.
    for (const key of [printScreen, f12]) {
      expect(native.callback!(0, down, key)).toBe(19n)
      expect(native.callback!(0, up, key)).toBe(19n)
    }
    native.GetAsyncKeyState.mockImplementation((key) => ([0x11, 0x10].includes(key) ? -32768 : 0))
    expect(native.callback!(0, down, 0x53n)).toBe(19n)
    expect(native.callback!(0, down, 0x53n)).toBe(19n)
    expect(native.callback!(0, up, 0x53n)).toBe(19n)
    native.GetAsyncKeyState.mockReturnValue(0)
    expect(native.callback!(0, down, 0x77n)).toBe(1)
    expect(native.callback!(0, up, 0x77n)).toBe(1)
    await flush()
    expect(capture).toHaveBeenCalledExactlyOnceWith(0x53)
    expect(select).toHaveBeenCalledTimes(1)
    expect(native.SetWindowsHookExW).toHaveBeenCalledTimes(1)
    expect(native.CallNextHookEx).toHaveBeenCalledTimes(7)
  })

  it('requires exact modifiers including both Windows keys and ignores modifier changes until a new press', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    const shortcuts = defaultShortcuts()
    shortcuts.capture = { ...shortcuts.capture, key: 'KeyK', ctrl: true, meta: true }
    const heldModifiers = new Set([0x11, 0x5c, 0x10])
    native.GetAsyncKeyState.mockImplementation((key) => (heldModifiers.has(key) ? -32768 : 0))
    listener = startPrintScreenListener(capture, select, () => shortcuts)
    expect(native.callback!(0, down, 0x4bn)).toBe(19n)
    heldModifiers.delete(0x10)
    expect(native.callback!(0, down, 0x4bn)).toBe(19n)
    await flush()
    expect(capture).not.toHaveBeenCalled()
    native.callback!(0, up, 0x4bn)
    native.callback!(0, down, 0x4bn)
    native.callback!(0, up, 0x4bn)
    heldModifiers.delete(0x5c)
    heldModifiers.add(0x5b)
    native.callback!(0, down, 0x4bn)
    await flush()
    expect(capture).toHaveBeenCalledTimes(2)
    expect(select).not.toHaveBeenCalled()
  })

  it('consumes an ROI key pair after modifier release and a binding change while held', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    let shortcuts = defaultShortcuts()
    shortcuts.selectRoi = { ...shortcuts.selectRoi, key: 'KeyR', alt: true }
    native.GetAsyncKeyState.mockImplementation((key) => (key === 0x12 ? -32768 : 0))
    listener = startPrintScreenListener(capture, select, () => shortcuts)
    expect(native.callback!(0, 0x0104, 0x52n)).toBe(1)
    native.GetAsyncKeyState.mockReturnValue(0)
    // Switching the same physical key to Capture must not create a second action mid-hold.
    shortcuts = {
      capture: { ...defaultShortcuts().capture, key: 'KeyR', ctrl: true },
      selectRoi: defaultShortcuts().selectRoi
    }
    expect(native.callback!(0, down, 0x52n)).toBe(1)
    expect(native.callback!(0, 0x0105, 0x52n)).toBe(1)
    await flush()
    expect(select).toHaveBeenCalledTimes(1)
    expect(capture).not.toHaveBeenCalled()
    native.GetAsyncKeyState.mockImplementation((key) => (key === 0x11 ? -32768 : 0))
    expect(native.callback!(0, down, 0x52n)).toBe(19n)
    await flush()
    expect(capture).toHaveBeenCalledExactlyOnceWith(0x52)
  })

  it('never swallows PrintScreen even with an invalid programmatic ROI binding', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    const shortcuts = defaultShortcuts()
    shortcuts.capture.key = 'F8'
    shortcuts.selectRoi.key = 'PrintScreen'
    listener = startPrintScreenListener(capture, select, () => shortcuts)
    expect(native.callback!(0, down, printScreen)).toBe(19n)
    expect(native.callback!(0, up, printScreen)).toBe(19n)
    await flush()
    expect(select).toHaveBeenCalledTimes(1)
    expect(capture).not.toHaveBeenCalled()
  })

  it('cancels queued callbacks and releases the hook once on exit', async () => {
    const capture = vi.fn()
    const select = vi.fn()
    listener = startPrintScreenListener(capture, select)
    native.callback!(0, down, printScreen)
    native.callback!(0, down, f12)
    listener.stop()
    listener.stop()
    await flush()
    expect(capture).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(native.UnhookWindowsHookEx).toHaveBeenCalledTimes(1)
    expect(native.unregister).toHaveBeenCalledTimes(1)
  })

  it('releases the callback when hook installation fails', () => {
    native.SetWindowsHookExW.mockReturnValue(null)
    expect(() => startPrintScreenListener(vi.fn(), vi.fn())).toThrow('Win32 5')
    expect(native.unregister).toHaveBeenCalledTimes(1)
    expect(native.UnhookWindowsHookEx).not.toHaveBeenCalled()
  })

  it('retains a callable forwarding hook after unhook failure and releases it on a later stop', async () => {
    const capture = vi.fn()
    listener = startPrintScreenListener(capture)
    native.callback!(0, down, printScreen)
    native.UnhookWindowsHookEx.mockReturnValueOnce(false)
    expect(() => listener!.stop()).toThrow('remove the PrintScreen keyboard hook')
    expect(native.unregister).not.toHaveBeenCalled()
    expect(native.callback!(0, down, printScreen)).toBe(19n)
    listener.stop()
    await flush()
    expect(capture).not.toHaveBeenCalled()
    expect(native.UnhookWindowsHookEx).toHaveBeenCalledTimes(2)
    expect(native.unregister).toHaveBeenCalledTimes(1)
  })
})
