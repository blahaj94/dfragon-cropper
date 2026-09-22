import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  callback: null as ((code: number, message: number, key: bigint | null) => number | bigint) | null,
  SetWindowsHookExW: vi.fn((): bigint | null => 1n),
  CallNextHookEx: vi.fn(() => 19n),
  UnhookWindowsHookEx: vi.fn(() => true),
  GetModuleHandleW: vi.fn(() => 1n),
  GetLastError: vi.fn(() => 5),
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
})
