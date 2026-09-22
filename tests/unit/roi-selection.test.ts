import { describe, expect, it, vi } from 'vitest'

// The boundary test does not create a window or claim native/display coverage.
vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: {}, screen: {} }))

import { validateSelectionRectangle } from '../../src/main/roi-selection'

describe('main-process overlay rectangle boundary', () => {
  const frame = { width: 1920, height: 1080 }

  it('returns a copied physical rectangle including exact right and bottom edges', () => {
    const rectangle = { x: 1919, y: 1079, width: 1, height: 1 }
    const result = validateSelectionRectangle(rectangle, frame)
    expect(result).toEqual(rectangle)
    expect(result).not.toBe(rectangle)
  })

  it('rejects malformed commands and dimensions without coercion, rounding or clipping', () => {
    for (const value of [
      null,
      [],
      { x: 0, y: 0, width: 10 },
      { x: 0, y: 0, width: 10, height: 10, id: 1 },
      { x: '0', y: 0, width: 10, height: 10 },
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 0.5, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 0, y: 0, width: 10, height: Infinity },
      { x: 1900, y: 0, width: 21, height: 10 },
      { x: 0, y: 1079, width: 10, height: 2 },
      { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 1 }
    ])
      expect(() => validateSelectionRectangle(value, frame)).toThrow()
  })
})
