import { describe, expect, it, vi } from 'vitest'
import { ShortcutKeyState } from '../../src/main/shortcuts/key-state'
import { inputVirtualKey } from '../../src/main/shortcuts/focused-input'
import { defaultShortcuts } from '../../src/shared/shortcuts'

const unmodified = { ctrl: false, alt: false, shift: false, meta: false }

describe('physical shortcut key pairs', () => {
  it('does not activate an already-held unrelated key when a binding changes to it', () => {
    const state = new ShortcutKeyState()
    const shortcuts = defaultShortcuts()
    const modifiers = vi.fn(() => unmodified)
    expect(state.handle(0x77, 'down', shortcuts, modifiers)).toEqual({ consume: false })
    expect(modifiers).not.toHaveBeenCalled()
    shortcuts.selectRoi.key = 'F8'
    expect(state.handle(0x77, 'down', shortcuts, modifiers)).toEqual({ consume: false })
    expect(state.handle(0x77, 'up', shortcuts, modifiers)).toEqual({ consume: false })
    expect(state.handle(0x77, 'down', shortcuts, modifiers)).toEqual({
      action: 'selectRoi',
      consume: true
    })
    expect(modifiers).toHaveBeenCalledTimes(1)
  })

  it('distinguishes actions with the same base key and preserves the original key-up policy', () => {
    const state = new ShortcutKeyState()
    const shortcuts = defaultShortcuts()
    shortcuts.capture = { ...shortcuts.selectRoi, ctrl: true }
    expect(state.handle(0x7b, 'down', shortcuts, () => ({ ...unmodified, ctrl: true }))).toEqual({
      action: 'capture',
      consume: false
    })
    expect(state.handle(0x7b, 'down', shortcuts, () => unmodified)).toEqual({ consume: false })
    expect(state.handle(0x7b, 'up', shortcuts, () => unmodified)).toEqual({ consume: false })
    expect(state.handle(0x7b, 'down', shortcuts, () => unmodified)).toEqual({
      action: 'selectRoi',
      consume: true
    })
    expect(state.handle(0x7b, 'up', shortcuts, () => ({ ...unmodified, ctrl: true }))).toEqual({
      consume: true
    })
  })

  it('keeps a consumed pair balanced if ROI selection is disabled before release', () => {
    const state = new ShortcutKeyState()
    const shortcuts = defaultShortcuts()
    const modifiers = () => unmodified
    expect(state.handle(0x7b, 'down', shortcuts, modifiers)).toEqual({
      action: 'selectRoi',
      consume: true
    })
    expect(state.handle(0x7b, 'down', shortcuts, modifiers, false)).toEqual({ consume: true })
    expect(state.handle(0x7b, 'up', shortcuts, modifiers, false)).toEqual({ consume: true })
    expect(state.handle(0x7b, 'down', shortcuts, modifiers, false)).toEqual({ consume: false })
  })

  it('resets key-pair state on teardown so later installations can receive fresh presses', () => {
    const state = new ShortcutKeyState()
    const shortcuts = defaultShortcuts()
    const modifiers = () => unmodified
    state.handle(0x7b, 'down', shortcuts, modifiers)
    state.handle(0x2c, 'down', shortcuts, modifiers)
    state.reset()
    expect(state.handle(0x7b, 'up', shortcuts, modifiers)).toEqual({ consume: false })
    expect(state.handle(0x7b, 'down', shortcuts, modifiers)).toEqual({
      action: 'selectRoi',
      consume: true
    })
    expect(state.handle(0x2c, 'down', shortcuts, modifiers)).toEqual({
      action: 'capture',
      consume: false
    })
  })
})

describe('focused Electron input normalization', () => {
  it('prefers the physical key code and falls back for synthetic key-only events', () => {
    expect(inputVirtualKey({ code: 'KeyR', key: 'ㄱ' })).toBe(0x52)
    expect(inputVirtualKey({ code: 'Digit4', key: '$' })).toBe(0x34)
    expect(inputVirtualKey({ code: 'F8', key: 'F8' })).toBe(0x77)
    expect(inputVirtualKey({ code: 'Unidentified', key: 'PrintScreen' })).toBe(0x2c)
    expect(inputVirtualKey({ key: 's' })).toBe(0x53)
    expect(inputVirtualKey({ key: '9' })).toBe(0x39)
    expect(inputVirtualKey({ key: 'Shift' })).toBeNull()
    expect(inputVirtualKey({ code: 'Escape', key: 'Escape' })).toBeNull()
  })
})
