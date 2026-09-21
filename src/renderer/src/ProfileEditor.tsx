import { useState, type FormEvent } from 'react'
import type { ProfileCommand, ProfileSettings, Region, SpikeState } from '../../shared/contracts'

type Rectangle = Omit<Region, 'id'>
type RectangleDraft = Record<keyof Rectangle, string>

const emptyRectangle: RectangleDraft = { x: '0', y: '0', width: '100', height: '100' }
const fields = ['x', 'y', 'width', 'height'] as const
const labels = { x: 'X', y: 'Y', width: 'Width', height: 'Height' }
const draftFrom = (region: Rectangle): RectangleDraft => ({
  x: String(region.x),
  y: String(region.y),
  width: String(region.width),
  height: String(region.height)
})

export function userError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

function rectangleFrom(draft: RectangleDraft): Rectangle {
  const rectangle = Object.fromEntries(
    fields.map((field) => [field, Number(draft[field])])
  ) as Rectangle
  if (
    fields.some(
      (field) =>
        draft[field].trim() === '' ||
        !Number.isSafeInteger(rectangle[field]) ||
        rectangle[field] < (field === 'x' || field === 'y' ? 0 : 1)
    )
  ) {
    throw new Error('Enter whole pixels: X and Y must be at least 0; width and height at least 1.')
  }
  return rectangle
}

function RectangleFields({
  draft,
  onChange
}: {
  draft: RectangleDraft
  onChange: (draft: RectangleDraft) => void
}) {
  return (
    <div className="rectangle-fields">
      {fields.map((field) => (
        <label key={field}>
          {labels[field]}
          <input
            type="number"
            min={field === 'x' || field === 'y' ? 0 : 1}
            step="1"
            value={draft[field]}
            onChange={(event) => onChange({ ...draft, [field]: event.target.value })}
          />
        </label>
      ))}
    </div>
  )
}

export function ProfileEditor({
  settings,
  settingsError,
  onCommand,
  onSavingChange
}: {
  settings: ProfileSettings | null
  settingsError: string | null
  onCommand: (command: ProfileCommand) => Promise<SpikeState>
  onSavingChange: (saving: boolean) => void
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [names, setNames] = useState<Record<number, string>>({})
  // Drafts are separate from pushed capture state and survive profile selection changes.
  const [rectangles, setRectangles] = useState<Record<string, RectangleDraft>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const selected =
    settings?.profiles.find((profile) => profile.id === selectedId) ??
    settings?.profiles.find((profile) => profile.id === settings.activeProfileId) ??
    settings?.profiles[0]

  function discardRectangle(key: string) {
    setRectangles((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  async function save(
    command: ProfileCommand | (() => ProfileCommand),
    message: string,
    onSaved?: (state: SpikeState) => void
  ) {
    setError(null)
    setNotice('')
    setSaving(true)
    onSavingChange(true)
    try {
      const next = await onCommand(typeof command === 'function' ? command() : command)
      onSaved?.(next)
      setNotice(message)
    } catch (reason) {
      setError(`Changes were not saved. ${userError(reason)}`)
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }

  function createProfile(event: FormEvent) {
    event.preventDefault()
    const knownIds = new Set(settings?.profiles.map((profile) => profile.id))
    void save(
      { type: 'create-profile', name: newName },
      'Profile created and active for captures.',
      (next) => {
        const created = next.settings?.profiles.find((profile) => !knownIds.has(profile.id))
        if (created) setSelectedId(created.id)
        setNewName('')
      }
    )
  }

  return (
    <section aria-labelledby="profile-editor-heading" className="profile-editor">
      <h2 id="profile-editor-heading">Profile Editor</h2>
      <p>Coordinates are whole physical pixels from the primary monitor’s top-left corner.</p>
      <p>
        Save name and ROI edits to apply them. Capture Now and PrintScreen use the saved active
        profile.
      </p>
      {settingsError && (
        <p role="alert">
          Profiles could not be loaded. {settingsError} The existing configuration has been kept.
          Fix the file and restart the app.
        </p>
      )}
      {!settings && !settingsError && <p>Loading profiles…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {settings && !settingsError && (
        <fieldset className="editor-controls" disabled={saving}>
          <legend className="visually-hidden">Profile settings</legend>
          <form onSubmit={createProfile} noValidate className="actions">
            <label>
              New profile name
              <input value={newName} onChange={(event) => setNewName(event.target.value)} />
            </label>
            <button type="submit" disabled={!newName.trim()}>
              Create profile
            </button>
          </form>

          {settings.profiles.length > 0 ? (
            <label className="profile-selection">
              Edit profile
              <select
                aria-label="Edit profile"
                value={selected?.id ?? ''}
                onChange={(event) => {
                  setSelectedId(Number(event.target.value))
                  setError(null)
                  setNotice('')
                }}
              >
                {settings.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} (#{profile.id})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No profiles. Create a profile and add an ROI to enable capture.</p>
          )}

          {selected && (
            <>
              <p>Profile ID: {selected.id} · IDs stay unchanged after creation.</p>
              <form
                className="actions"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  void save(
                    {
                      type: 'rename-profile',
                      profileId: selected.id,
                      name: names[selected.id] ?? selected.name
                    },
                    'Profile name saved.',
                    () =>
                      setNames((current) => {
                        const next = { ...current }
                        delete next[selected.id]
                        return next
                      })
                  )
                }}
              >
                <label>
                  Profile name
                  <input
                    value={names[selected.id] ?? selected.name}
                    onChange={(event) => setNames({ ...names, [selected.id]: event.target.value })}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    names[selected.id] === undefined || names[selected.id] === selected.name
                  }
                >
                  Save name
                </button>
                <button
                  type="button"
                  disabled={
                    names[selected.id] === undefined || names[selected.id] === selected.name
                  }
                  onClick={() => {
                    setNames((current) => {
                      const next = { ...current }
                      delete next[selected.id]
                      return next
                    })
                    setError(null)
                  }}
                >
                  Discard name changes
                </button>
              </form>
              {names[selected.id] !== undefined && names[selected.id] !== selected.name && (
                <p className="draft-notice">Unsaved name changes</p>
              )}
              <div className="actions">
                <button
                  type="button"
                  disabled={settings.activeProfileId === selected.id}
                  onClick={() =>
                    void save(
                      { type: 'activate-profile', profileId: selected.id },
                      'Active capture profile saved.'
                    )
                  }
                >
                  {settings.activeProfileId === selected.id
                    ? 'Active for captures'
                    : 'Use for captures'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void save(
                      { type: 'delete-profile', profileId: selected.id },
                      'Profile deleted.'
                    )
                  }
                >
                  Delete profile
                </button>
              </div>

              <h3>Regions of interest</h3>
              {selected.regions.length === 0 && <p>No saved ROIs in this profile.</p>}
              {selected.regions.map((region) => {
                const key = `${selected.id}:${region.id}`
                const draft = rectangles[key] ?? draftFrom(region)
                const dirty = fields.some((field) => draft[field] !== String(region[field]))
                return (
                  <form
                    key={key}
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save(
                        () => ({
                          type: 'update-region',
                          profileId: selected.id,
                          regionId: region.id,
                          rectangle: rectangleFrom(draft)
                        }),
                        `ROI #${region.id} saved.`,
                        () => discardRectangle(key)
                      )
                    }}
                  >
                    <fieldset className="region">
                      <legend>ROI #{region.id}</legend>
                      <RectangleFields
                        draft={draft}
                        onChange={(next) => setRectangles({ ...rectangles, [key]: next })}
                      />
                      {dirty && <p className="draft-notice">Unsaved changes</p>}
                      <div className="actions">
                        <button type="submit" disabled={!dirty}>
                          Save ROI
                        </button>
                        <button
                          type="button"
                          disabled={!dirty}
                          onClick={() => discardRectangle(key)}
                        >
                          Discard changes
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void save(
                              {
                                type: 'delete-region',
                                profileId: selected.id,
                                regionId: region.id
                              },
                              `ROI #${region.id} deleted.`,
                              () => discardRectangle(key)
                            )
                          }
                        >
                          Delete ROI
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )
              })}

              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  const key = `${selected.id}:new`
                  void save(
                    () => ({
                      type: 'add-region',
                      profileId: selected.id,
                      rectangle: rectangleFrom(rectangles[key] ?? emptyRectangle)
                    }),
                    'ROI added.',
                    () => discardRectangle(key)
                  )
                }}
              >
                <fieldset className="region">
                  <legend>New ROI</legend>
                  <RectangleFields
                    draft={rectangles[`${selected.id}:new`] ?? emptyRectangle}
                    onChange={(next) =>
                      setRectangles({ ...rectangles, [`${selected.id}:new`]: next })
                    }
                  />
                  <button type="submit">Add ROI</button>
                </fieldset>
              </form>
            </>
          )}
        </fieldset>
      )}
    </section>
  )
}
