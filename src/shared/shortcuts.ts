export const SHORTCUT_KEYS = [
  'PrintScreen',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'F21',
  'F22',
  'F23',
  'F24',
  'Pause',
  'ScrollLock',
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyM',
  'KeyN',
  'KeyO',
  'KeyP',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyT',
  'KeyU',
  'KeyV',
  'KeyW',
  'KeyX',
  'KeyY',
  'KeyZ',
  'Digit0',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9'
] as const

export type ShortcutKey = (typeof SHORTCUT_KEYS)[number]

export interface KeyBinding {
  key: ShortcutKey
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export interface ShortcutSettings {
  capture: KeyBinding
  selectRoi: KeyBinding
}

export function defaultShortcuts(): ShortcutSettings {
  return {
    capture: { key: 'PrintScreen', ctrl: false, alt: false, shift: false, meta: false },
    selectRoi: { key: 'F12', ctrl: false, alt: false, shift: false, meta: false }
  }
}

export function formatShortcut(binding: KeyBinding): string {
  const key = binding.key.replace(/^(Key|Digit)/, '').replace('ScrollLock', 'Scroll Lock')
  return [
    binding.ctrl && 'Ctrl',
    binding.alt && 'Alt',
    binding.shift && 'Shift',
    binding.meta && 'Win',
    key
  ]
    .filter(Boolean)
    .join('+')
}

/** Windows VK codes refer to letter keys, independent of the text produced by the current IME. */
export function shortcutVirtualKey(key: ShortcutKey): number {
  if (key.startsWith('Key')) return key.charCodeAt(3)
  if (key.startsWith('Digit')) return key.charCodeAt(5)
  if (key.startsWith('F')) return 0x6f + Number(key.slice(1))
  switch (key) {
    case 'PrintScreen':
      return 0x2c
    case 'Pause':
      return 0x13
    case 'ScrollLock':
      return 0x91
    default:
      throw new Error('Unsupported shortcut key.')
  }
}

function fields(value: unknown, expected: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(input, key))
  ) {
    throw new Error(`${label} must contain only ${expected.join(', ')}.`)
  }
  return input
}

function parseBinding(value: unknown, label: string): KeyBinding {
  const input = fields(value, ['key', 'ctrl', 'alt', 'shift', 'meta'], label)
  if (typeof input.key !== 'string' || !SHORTCUT_KEYS.includes(input.key as ShortcutKey)) {
    throw new Error(
      `${label}: choose a function key, PrintScreen, Pause, Scroll Lock, letter or digit.`
    )
  }
  if (['ctrl', 'alt', 'shift', 'meta'].some((key) => typeof input[key] !== 'boolean')) {
    throw new Error(`${label} modifiers must be booleans.`)
  }
  const binding: KeyBinding = {
    key: input.key as ShortcutKey,
    ctrl: input.ctrl as boolean,
    alt: input.alt as boolean,
    shift: input.shift as boolean,
    meta: input.meta as boolean
  }
  if (/^(Key|Digit)/.test(binding.key) && !binding.ctrl && !binding.alt && !binding.meta) {
    throw new Error(
      `${label}: letters and digits need Ctrl, Alt or Win so ordinary typing stays available.`
    )
  }
  if (binding.ctrl && (binding.key === 'Pause' || binding.key === 'ScrollLock')) {
    throw new Error(
      `${label}: Ctrl+Pause and Ctrl+Scroll Lock send a different Windows key code. Choose another shortcut.`
    )
  }
  if ((binding.alt && binding.key === 'F4') || (binding.meta && binding.key === 'KeyL')) {
    throw new Error(`${label}: this combination is reserved by Windows. Choose another shortcut.`)
  }
  return binding
}

export function parseShortcutSettings(value: unknown): ShortcutSettings {
  const input = fields(value, ['capture', 'selectRoi'], 'Shortcuts')
  const capture = parseBinding(input.capture, 'Capture shortcut')
  const selectRoi = parseBinding(input.selectRoi, 'ROI selection shortcut')
  if (selectRoi.key === 'PrintScreen') {
    throw new Error(
      'PrintScreen is available only for Capture so its normal Windows action stays available.'
    )
  }
  if (formatShortcut(capture) === formatShortcut(selectRoi)) {
    throw new Error('Capture and ROI selection must use different shortcuts.')
  }
  return { capture, selectRoi }
}
