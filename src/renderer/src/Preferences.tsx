import { useState } from 'react'
import type { ProfileCommand, ProfileSettings, SpikeState } from '../../shared/contracts'
import { userError } from './errors'
import { ShortcutPreferences } from './settings/ShortcutPreferences'
import { formatShortcut } from '../../shared/shortcuts'

export function Preferences({
  settings,
  blocked,
  outputDirectory,
  backgroundAvailable,
  onCommand,
  onSavingChange
}: {
  settings: ProfileSettings | null
  blocked: boolean
  outputDirectory: string
  backgroundAvailable: boolean
  onCommand: (command: ProfileCommand) => Promise<SpikeState>
  onSavingChange: (saving: boolean) => void
}) {
  const [draft, setDraft] = useState<ProfileSettings['preferences'] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const preferences = draft ?? settings?.preferences
  const dirty =
    !!draft &&
    (draft.saveOriginal !== settings?.preferences.saveOriginal ||
      draft.closeToTray !== settings?.preferences.closeToTray)

  function change(value: ProfileSettings['preferences']) {
    setDraft(value)
    setError(null)
    setNotice('')
  }
  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      <p>Output folder</p>
      <p className="file-path">{outputDirectory || 'Loading…'}</p>
      {!backgroundAvailable && <p>Tray controls become available on Windows.</p>}
      {!settings && <p>Settings are unavailable until the configuration loads successfully.</p>}
      {error && !blocked && <p role="alert">Settings were not saved. {error}</p>}
      {notice && !blocked && <p role="status">{notice}</p>}
      {preferences && (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (blocked || saving) return
            setSaving(true)
            onSavingChange(true)
            setError(null)
            setNotice('')
            try {
              await onCommand({ type: 'set-preferences', ...preferences })
              setDraft(null)
              setNotice('Settings saved.')
            } catch (reason) {
              setError(userError(reason))
            } finally {
              setSaving(false)
              onSavingChange(false)
            }
          }}
        >
          <fieldset className="editor-controls" disabled={saving || blocked}>
            <legend className="visually-hidden">Capture preferences</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.saveOriginal}
                onChange={(event) => change({ ...preferences, saveOriginal: event.target.checked })}
              />
              Save original PNG
            </label>
            <p>ROI PNGs are always saved. Turning this off affects future captures.</p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.closeToTray}
                onChange={(event) => change({ ...preferences, closeToTray: event.target.checked })}
              />
              Close window to tray
            </label>
            <p>
              Keep listening for{' '}
              {settings ? formatShortcut(settings.shortcuts.capture) : 'the capture shortcut'} after
              closing the window. Use Quit to stop the app.
            </p>
            {dirty && <p className="draft-notice">Unsaved settings</p>}
            <div className="actions">
              <button type="submit" disabled={!dirty}>
                Save settings
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={() => {
                  setDraft(null)
                  setError(null)
                  setNotice('')
                }}
              >
                Discard settings changes
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {settings && (
        <ShortcutPreferences
          shortcuts={settings.shortcuts}
          blocked={blocked || saving}
          onCommand={onCommand}
          onSavingChange={onSavingChange}
        />
      )}
    </section>
  )
}
