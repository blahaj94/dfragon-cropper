import { describe, expect, it } from 'vitest'
import {
  defaultShortcuts,
  formatShortcut,
  parseShortcutSettings,
  SHORTCUT_KEYS,
  shortcutVirtualKey
} from '../../src/shared/shortcuts'

describe('keyboard binding contract', () => {
  it('keeps the existing default keys and detaches both defaults and validated settings', () => {
    const settings = defaultShortcuts()
    expect(formatShortcut(settings.capture)).toBe('PrintScreen')
    expect(formatShortcut(settings.selectRoi)).toBe('F12')
    const parsed = parseShortcutSettings(settings)
    settings.capture.key = 'F7'
    expect(parsed.capture.key).toBe('PrintScreen')
    expect(defaultShortcuts().capture.key).toBe('PrintScreen')
  })

  it('accepts modified letter/digit keys and formats the exact modifier combination', () => {
    const settings = defaultShortcuts()
    settings.capture = { key: 'KeyS', ctrl: true, alt: false, shift: true, meta: false }
    settings.selectRoi = { key: 'Digit4', ctrl: false, alt: true, shift: false, meta: false }
    expect(parseShortcutSettings(settings)).toEqual(settings)
    expect(formatShortcut(settings.capture)).toBe('Ctrl+Shift+S')
    expect(formatShortcut(settings.selectRoi)).toBe('Alt+4')
    expect(
      formatShortcut({ ...settings.selectRoi, key: 'ScrollLock', alt: false, meta: true })
    ).toBe('Win+Scroll Lock')
  })

  it('maps every supported trigger key to a unique Windows virtual key', () => {
    const codes = SHORTCUT_KEYS.map(shortcutVirtualKey)
    expect(new Set(codes).size).toBe(SHORTCUT_KEYS.length)
    expect(shortcutVirtualKey('PrintScreen')).toBe(0x2c)
    expect(shortcutVirtualKey('F1')).toBe(0x70)
    expect(shortcutVirtualKey('F24')).toBe(0x87)
    expect(shortcutVirtualKey('KeyA')).toBe(0x41)
    expect(shortcutVirtualKey('KeyZ')).toBe(0x5a)
    expect(shortcutVirtualKey('Digit0')).toBe(0x30)
    expect(shortcutVirtualKey('Digit9')).toBe(0x39)
    expect(shortcutVirtualKey('Pause')).toBe(0x13)
    expect(shortcutVirtualKey('ScrollLock')).toBe(0x91)
  })

  it.each([
    { key: 'KeyA' },
    { key: 'Digit2', shift: true },
    { key: 'F4', alt: true },
    { key: 'KeyL', meta: true },
    { key: 'Pause', ctrl: true },
    { key: 'Pause', ctrl: true, alt: true, shift: true, meta: true },
    { key: 'ScrollLock', ctrl: true },
    { key: 'ScrollLock', ctrl: true, alt: true, shift: true, meta: true },
    { key: 'Escape' },
    { key: 'F25' },
    { key: 'Keya', ctrl: true },
    { ctrl: 'true' },
    { extra: true }
  ])('rejects unsafe, unsupported or malformed bindings: %j', (invalid) => {
    const settings = defaultShortcuts()
    expect(() =>
      parseShortcutSettings({
        ...settings,
        capture: { ...settings.capture, ...invalid }
      })
    ).toThrow()
  })

  it('rejects duplicate bindings but accepts the same key with distinct modifiers', () => {
    const settings = defaultShortcuts()
    settings.capture = { ...settings.selectRoi }
    expect(() => parseShortcutSettings(settings)).toThrow('different shortcuts')
    settings.capture.ctrl = true
    expect(parseShortcutSettings(settings)).toEqual(settings)
  })

  it('reserves PrintScreen for pass-through capture and rejects incomplete settings', () => {
    const settings = defaultShortcuts()
    settings.selectRoi = { ...settings.capture, ctrl: true }
    expect(() => parseShortcutSettings(settings)).toThrow('only for Capture')
    expect(() => parseShortcutSettings({ capture: settings.capture })).toThrow()
    expect(() => parseShortcutSettings({ ...defaultShortcuts(), extra: true })).toThrow()
    expect(() => parseShortcutSettings(null)).toThrow()
    expect(() => parseShortcutSettings({ ...defaultShortcuts(), capture: { key: 'F8' } })).toThrow()
  })
})
