import koffi from 'koffi'

const WH_KEYBOARD_LL = 13
const VK_SNAPSHOT = 0x2c
const WM_KEYDOWN = 0x0100
const WM_KEYUP = 0x0101
const WM_SYSKEYDOWN = 0x0104
const WM_SYSKEYUP = 0x0105

export interface PrintScreenListener {
  stop(): void
}

/** Start after Electron is ready so the installing thread has its Windows message loop. */
export function startPrintScreenListener(onPress: () => void): PrintScreenListener {
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
  let active = true
  let down = false
  let released = false
  const pending = new Set<NodeJS.Immediate>()

  const callback = koffi.register(
    (code: number, message: number | bigint, key: bigint | null): number | bigint => {
      try {
        // Inspect only the first DWORD (vkCode); neither key contents nor other keys are stored.
        if (active && code === 0 && key !== null && koffi.decode.uint32(key) === VK_SNAPSHOT) {
          const event = Number(message)
          if (event === WM_KEYUP || event === WM_SYSKEYUP) {
            down = false
          } else if ((event === WM_KEYDOWN || event === WM_SYSKEYDOWN) && !down) {
            down = true
            const notification = setImmediate(() => {
              pending.delete(notification)
              if (active) onPress()
            })
            pending.add(notification)
          }
        }
      } catch {
        // Decoding/scheduling failure must never suppress the original Windows key event.
      }
      // Forward negative codes, unrelated keys and PrintScreen alike, returning the native result.
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
      down = false
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
