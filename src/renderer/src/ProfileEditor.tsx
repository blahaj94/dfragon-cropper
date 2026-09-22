import { ScreenPreview } from './ScreenPreview'
import { RectangleFields } from './profile-editor/RectangleFields'
import { RegionEditor } from './profile-editor/RegionEditor'
import { useProfileEditor, type ProfileEditorInputs } from './profile-editor/useProfileEditor'
import { defaultShortcuts, formatShortcut } from '../../shared/shortcuts'

export function ProfileEditor(
  props: ProfileEditorInputs & {
    previewDisabled: boolean
    settingsSaving: boolean
    selectionShortcutStatus: string
  }
) {
  const { settings, settingsError, previewDisabled, selectionShortcutStatus, settingsSaving } =
    props
  const editor = useProfileEditor(props)
  const { selected } = editor
  const shortcuts = settings?.shortcuts ?? defaultShortcuts()

  return (
    <section aria-labelledby="profile-editor-heading" className="profile-editor">
      <h2 id="profile-editor-heading">Profile Editor</h2>
      <p>Coordinates are whole physical pixels from the primary monitor’s top-left corner.</p>
      <p>
        Save name and ROI edits to apply them. Capture Now and {formatShortcut(shortcuts.capture)}{' '}
        use the saved active profile.
      </p>
      {!settings && !settingsError && <p>Loading profiles…</p>}
      {editor.error && !settingsError && <p role="alert">{editor.error}</p>}
      {editor.notice && !settingsError && <p role="status">{editor.notice}</p>}
      {settings && (
        <fieldset
          className="editor-controls"
          disabled={editor.saving || editor.selecting || settingsSaving || !!settingsError}
        >
          <legend className="visually-hidden">Profile settings</legend>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void editor.createProfile()
            }}
            noValidate
            className="actions"
          >
            <label>
              New profile name
              <input
                value={editor.newName}
                onChange={(event) => editor.setNewName(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!editor.newName.trim()}>
              Create profile
            </button>
          </form>
          {settings.profiles.length > 0 ? (
            <label className="profile-selection">
              Edit profile
              <select
                aria-label="Edit profile"
                value={selected?.id ?? ''}
                onChange={(event) => editor.selectProfile(Number(event.target.value))}
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
                  void editor.saveName()
                }}
              >
                <label>
                  Profile name
                  <input
                    value={editor.name}
                    onChange={(event) => editor.changeName(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={!editor.nameDirty}>
                  Save name
                </button>
                <button type="button" disabled={!editor.nameDirty} onClick={editor.discardName}>
                  Discard name changes
                </button>
              </form>
              {editor.nameDirty && <p className="draft-notice">Unsaved name changes</p>}
              <div className="actions">
                <button
                  type="button"
                  disabled={settings.activeProfileId === selected.id}
                  onClick={() => void editor.activateProfile()}
                >
                  {settings.activeProfileId === selected.id
                    ? 'Active for captures'
                    : 'Use for captures'}
                </button>
                <button type="button" onClick={() => void editor.deleteProfile()}>
                  Delete profile
                </button>
              </div>
              <ScreenPreview
                profileId={selected.id}
                profileName={selected.name}
                regions={selected.regions}
                drafts={editor.previewDrafts}
                disabled={previewDisabled || editor.saving || !!settingsError}
                shortcutStatus={selectionShortcutStatus}
                shortcutLabel={formatShortcut(shortcuts.selectRoi)}
                isTargetAvailable={editor.isTargetAvailable}
                onBusyChange={editor.selectionBusyChanged}
                onSelectionComplete={editor.selectionCompleted}
                onRedraw={editor.stageRegion}
                onSave={editor.saveRegion}
                onDiscard={editor.discardRegion}
                onAdd={editor.addDrawnRegion}
              />
              <h3>Regions of interest</h3>
              {selected.regions.length === 0 && <p>No saved ROIs in this profile.</p>}
              {selected.regions.map((region) => (
                <RegionEditor
                  key={`${selected.id}:${region.id}`}
                  region={region}
                  draft={editor.regionDraft(region)}
                  preview={editor.previewDrafts[region.id]}
                  onChange={(draft) => editor.changeRegion(region.id, draft)}
                  onSave={() => editor.saveRegion(region.id)}
                  onDiscard={() => editor.discardRegion(region.id)}
                  onDelete={() => editor.deleteRegion(region.id)}
                />
              ))}
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  void editor.addNumericRegion()
                }}
              >
                <fieldset className="region">
                  <legend>New ROI</legend>
                  <RectangleFields
                    draft={editor.newRectangle}
                    onChange={(draft) => editor.changeRegion('new', draft)}
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
