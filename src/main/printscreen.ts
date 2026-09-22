import koffi from 'koffi'
import { defaultShortcuts, type ShortcutSettings } from '../shared/shortcuts'
import { ShortcutKeyState } from './shortcuts/key-state'

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const WM_KEYUP = 0x0101
const WM_SYSKEYDOWN = 0x0104
const WM_SYSKEYUP = 0x0105

export interface PrintScreenListener {
  stop(): void
}

/** Start after Electron is ready so the installing thread has its Windows message loop. */
export function startPrintScreenListener(
  onPress: (virtualKey: number) => void,
  onSelectRoi?: () => void,
  getShortcuts: () => ShortcutSettings = defaultShortcuts
): PrintScreenListener {
  if (process.platform !== 'win32') {
    throw new Error('The PrintScreen keyboard listener requires Windows.')
  }

  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  // LPARAM holds a KBDLLHOOKSTRUCT pointer here; LRESULT and WPARAM are pointer-sized.
  const hookProcedure = koffi.proto('__stdcall', null, 'intptr_t', [
    'int32_t',
    'uintptr_t',
    'void *'
  ])
  const setHook = user32.func('__stdcall', 'SetWindowsHookExW', 'void *', [
    'int32_t',
    koffi.pointer(hookProcedure),
    'void *',
    'uint32_t'
  ])
  const nextHook = user32.func('__stdcall', 'CallNextHookEx', 'intptr_t', [
    'void *',
    'int32_t',
    'uintptr_t',
    'void *'
  ])
  const unhook = user32.func('__stdcall', 'UnhookWindowsHookEx', 'bool', ['void *'])
  const getModuleHandle = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16'])
  const getLastError = kernel32.func('__stdcall', 'GetLastError', 'uint32_t', [])
  const getAsyncKeyState = user32.func('__stdcall', 'GetAsyncKeyState', 'int16_t', ['int32_t'])
  const held = (key: number) => (Number(getAsyncKeyState(key)) & 0x8000) !== 0
  const readModifiers = () => ({
    ctrl: held(0x11),
    alt: held(0x12),
    shift: held(0x10),
    meta: held(0x5b) || held(0x5c)
  })
  let active = true
  const keys = new ShortcutKeyState()
  let released = false
  const pending = new Set<NodeJS.Immediate>()

  const callback = koffi.register(
    (code: number, message: number | bigint, key: bigint | null): number | bigint => {
      let consumeSelectionKey = false
      try {
        // Inspect only vkCode; key-pair state is transient and input is never logged.
        if (active && code === 0 && key !== null) {
          const virtualKey = koffi.decode.uint32(key)
          const event = Number(message)
          const phase =
            event === WM_KEYDOWN || event === WM_SYSKEYDOWN
              ? 'down'
              : event === WM_KEYUP || event === WM_SYSKEYUP
                ? 'up'
                : null
          const result = phase
            ? keys.handle(virtualKey, phase, getShortcuts(), readModifiers, !!onSelectRoi)
            : { consume: false, action: undefined }
          consumeSelectionKey = result.consume
          const notify =
            result.action === 'capture'
              ? () => onPress(virtualKey)
              : result.action === 'selectRoi'
                ? onSelectRoi
                : undefined
          if (notify) {
            const notification = setImmediate(() => {
              pending.delete(notification)
              if (active) notify()
            })
            pending.add(notification)
          }
        }
      } catch {
        // Decoding/scheduling failure must never suppress the Windows PrintScreen event.
      }
      if (consumeSelectionKey) return 1
      // PrintScreen, negative codes and unrelated keys always return the native next-hook result.
      return nextHook(null, code, message, key) as number | bigint
    },
    koffi.pointer(hookProcedure)
  )

  let handle: bigint | null
  try {
    handle = setHook(WH_KEYBOARD_LL, callback, getModuleHandle(null), 0) as bigint | null
    if (handle === null) {
      throw new Error(`Could not install the PrintScreen keyboard hook (Win32 ${getLastError()}).`)
    }
  } catch (error) {
    active = false
    koffi.unregister(callback)
    throw error
  }

  return {
    stop(): void {
      if (released) return
      active = false
      keys.reset()
      for (const notification of pending) clearImmediate(notification)
      pending.clear()
      if (!unhook(handle)) {
        // Keep the native callback alive if Windows might still call it; a later stop may retry.
        throw new Error(`Could not remove the PrintScreen keyboard hook (Win32 ${getLastError()}).`)
      }
      released = true
      koffi.unregister(callback)
    }
  }
}
