import { useState } from 'react'
import type { ProfileCommand, SpikeState } from '../../../shared/contracts'
import {
  defaultShortcuts,
  formatShortcut,
  parseShortcutSettings,
  SHORTCUT_KEYS,
  type KeyBinding,
  type ShortcutKey,
  type ShortcutSettings
} from '../../../shared/shortcuts'
import { userError } from '../errors'
import './shortcuts.css'

function BindingFields({
  title,
  value,
  onChange
}: {
  title: string
  value: KeyBinding
  onChange: (value: KeyBinding) => void
}) {
  return (
    <fieldset className="shortcut-binding">
      <legend>{title}</legend>
      <label>
        {title} key
        <select
          value={value.key}
          onChange={(event) => onChange({ ...value, key: event.target.value as ShortcutKey })}
        >
          {SHORTCUT_KEYS.map((key) => (
            <option key={key} value={key}>
              {formatShortcut({ key, ctrl: false, alt: false, shift: false, meta: false })}
            </option>
          ))}
        </select>
      </label>
      <div className="shortcut-modifiers">
        {(
          [
            ['ctrl', 'Ctrl'],
            ['alt', 'Alt'],
            ['shift', 'Shift'],
            ['meta', 'Win']
          ] as const
        ).map(([modifier, label]) => (
          <label key={modifier} className="checkbox">
            <input
              type="checkbox"
              checked={value[modifier]}
              onChange={(event) => onChange({ ...value, [modifier]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <output aria-label={`${title} draft`}>{formatShortcut(value)}</output>
    </fieldset>
  )
}

export function ShortcutPreferences({
  shortcuts,
  blocked,
  onCommand,
  onSavingChange
}: {
  shortcuts: ShortcutSettings
  blocked: boolean
  onCommand: (command: ProfileCommand) => Promise<SpikeState>
  onSavingChange: (saving: boolean) => void
}) {
  const [draft, setDraft] = useState<ShortcutSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const values = draft ?? shortcuts
  const dirty =
    formatShortcut(values.capture) !== formatShortcut(shortcuts.capture) ||
    formatShortcut(values.selectRoi) !== formatShortcut(shortcuts.selectRoi)

  function change(value: ShortcutSettings | null) {
    setDraft(value)
    setError(null)
    setNotice('')
  }

  async function save() {
    if (blocked || saving || !dirty) return
    setError(null)
    setNotice('')
    try {
      const validated = parseShortcutSettings(values)
      setSaving(true)
      onSavingChange(true)
      await onCommand({ type: 'set-shortcuts', shortcuts: validated })
      setDraft(null)
      setNotice('Shortcuts saved.')
    } catch (reason) {
      setError(userError(reason))
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }

  return (
    <section className="shortcut-preferences" aria-labelledby="shortcuts-heading">
      <h3 id="shortcuts-heading">Keyboard shortcuts</h3>
      <p data-testid="saved-shortcuts">
        In use: Capture <strong>{formatShortcut(shortcuts.capture)}</strong> · ROI selection{' '}
        <strong>{formatShortcut(shortcuts.selectRoi)}</strong>
      </p>
      <p>
        Choose a key and modifiers, then save. Use exactly the selected modifiers when pressing it.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset className="editor-controls" disabled={blocked || saving}>
          <legend className="visually-hidden">Keyboard shortcut settings</legend>
          <div className="shortcut-bindings">
            <BindingFields
              title="Capture"
              value={values.capture}
              onChange={(capture) => change({ ...values, capture })}
            />
            <BindingFields
              title="ROI selection"
              value={values.selectRoi}
              onChange={(selectRoi) => change({ ...values, selectRoi })}
            />
          </div>
          <p>
            Letters and numbers require Ctrl, Alt or Win. PrintScreen is available for Capture only.
            Ctrl+Pause and Ctrl+Scroll Lock are not supported.
          </p>
          {dirty && <p className="draft-notice">Unsaved shortcut changes</p>}
          <div className="actions">
            <button type="submit" disabled={!dirty}>
              {saving ? 'Saving shortcuts…' : 'Save shortcuts'}
            </button>
            <button type="button" disabled={!dirty} onClick={() => change(null)}>
              Discard shortcut changes
            </button>
            <button type="button" onClick={() => change(defaultShortcuts())}>
              Restore default shortcuts
            </button>
          </div>
        </fieldset>
      </form>
      {error && !blocked && <p role="alert">Shortcuts were not saved. {error}</p>}
      {notice && !blocked && <p role="status">{notice}</p>}
    </section>
  )
}
