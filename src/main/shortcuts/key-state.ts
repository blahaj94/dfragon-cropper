import {
  SHORTCUT_KEYS,
  shortcutVirtualKey,
  type KeyBinding,
  type ShortcutSettings
} from '../../shared/shortcuts'

export type ShortcutAction = 'capture' | 'selectRoi'
export type Modifiers = Pick<KeyBinding, 'ctrl' | 'alt' | 'shift' | 'meta'>
const supportedKeys = new Set(SHORTCUT_KEYS.map(shortcutVirtualKey))

export function matchesShortcut(binding: KeyBinding, key: number, modifiers: Modifiers): boolean {
  return (
    shortcutVirtualKey(binding.key) === key &&
    binding.ctrl === modifiers.ctrl &&
    binding.alt === modifiers.alt &&
    binding.shift === modifiers.shift &&
    binding.meta === modifiers.meta
  )
}

/** Track physical key pairs independently of a binding or modifier change while held. */
export class ShortcutKeyState {
  private down = new Set<number>()
  private consumed = new Set<number>()

  handle(
    key: number,
    phase: 'down' | 'up',
    shortcuts: ShortcutSettings,
    readModifiers: () => Modifiers,
    selectionEnabled = true
  ): { action?: ShortcutAction; consume: boolean } {
    if (phase === 'up') {
      this.down.delete(key)
      return { consume: this.consumed.delete(key) }
    }
    if (!supportedKeys.has(key)) return { consume: false }
    if (this.down.has(key)) return { consume: this.consumed.has(key) }
    this.down.add(key)
    if (
      key !== shortcutVirtualKey(shortcuts.capture.key) &&
      (!selectionEnabled || key !== shortcutVirtualKey(shortcuts.selectRoi.key))
    )
      return { consume: false }
    const modifiers = readModifiers()
    const action = matchesShortcut(shortcuts.capture, key, modifiers)
      ? 'capture'
      : selectionEnabled && matchesShortcut(shortcuts.selectRoi, key, modifiers)
        ? 'selectRoi'
        : undefined
    // Even an invalid programmatic binding must never swallow PrintScreen.
    const consume = action === 'selectRoi' && key !== 0x2c
    if (consume) this.consumed.add(key)
    return { action, consume }
  }

  reset(): void {
    this.down.clear()
    this.consumed.clear()
  }
}
