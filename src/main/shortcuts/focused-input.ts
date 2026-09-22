import { SHORTCUT_KEYS, shortcutVirtualKey, type ShortcutKey } from '../../shared/shortcuts'

/** Use the layout's key name, then its code for IME/composition and synthetic input. */
export function inputVirtualKey(input: { code?: string; key: string }): number | null {
  for (const value of [input.key, input.code]) {
    if (!value) continue
    if (SHORTCUT_KEYS.includes(value as ShortcutKey))
      return shortcutVirtualKey(value as ShortcutKey)
    if (/^[a-z]$/i.test(value)) return value.toUpperCase().charCodeAt(0)
    if (/^[0-9]$/.test(value)) return value.charCodeAt(0)
  }
  return null
}
