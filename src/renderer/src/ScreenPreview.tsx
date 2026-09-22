import { useRoiSelector, type RoiSelectorInputs } from './roi-selector/useRoiSelector'
import './roi-preview.css'

export function ScreenPreview(
  props: RoiSelectorInputs & {
    profileName: string
    shortcutStatus: string
    onSave: (regionId: number) => Promise<boolean>
    onDiscard: (regionId: number) => void
  }
) {
  const { profileId, profileName, regions, disabled, shortcutStatus, onSave, onDiscard } = props
  const selector = useRoiSelector(props)
  const { target, regionId, draft, replacement, rectangle, loading, error, select } = selector

  return (
    <section className="screen-preview roi-selector" aria-labelledby="screen-preview-heading">
      <div className="section-heading">
        <div>
          <h3 id="screen-preview-heading">Select an area on the primary screen</h3>
          <p>Press F12 or select below, then drag on the frozen screen. Press Esc to cancel.</p>
        </div>
        <button type="button" disabled={disabled || loading} onClick={() => void select()}>
          {loading ? 'Selecting ROI…' : 'Select ROI (F12)'}
        </button>
      </div>
      <p className="selection-shortcut-status">{shortcutStatus}</p>
      <label className="preview-target">
        Preview target
        <select
          aria-label="Preview target"
          value={regionId ?? 'new'}
          disabled={disabled || loading}
          onChange={(event) =>
            selector.changeTarget(event.target.value === 'new' ? null : Number(event.target.value))
          }
        >
          <option value="new">New ROI</option>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              ROI #{region.id}
            </option>
          ))}
        </select>
      </label>
      <p className="preview-instructions">
        {target
          ? `Select a new area for ROI #${target.id}. Save explicitly to apply the draft to captures.`
          : 'Select an area, then add a new ROI or apply it to an existing ROI below.'}
      </p>
      {error && <p role="alert">ROI selection failed. {error}</p>}
      {target && draft?.error && (
        <p className="roi-validation" role="status" data-testid="preview-draft-error">
          ROI #{target.id} has an invalid numeric draft. {draft.error} The saved ROI is unchanged;
          correct the fields or select a new area before saving.
        </p>
      )}
      <p className="selection-readout" data-testid="drawn-rectangle">
        {rectangle
          ? `X ${rectangle.x} · Y ${rectangle.y} · Width ${rectangle.width} · Height ${rectangle.height} physical pixels`
          : target && draft?.error
            ? 'Invalid numeric draft. The saved ROI is unchanged.'
            : 'No area selected yet.'}
      </p>
      <div className="actions preview-actions">
        {target ? (
          <>
            <button
              type="button"
              disabled={disabled || loading || !draft?.dirty || !!draft.error}
              onClick={() => void onSave(target.id)}
            >
              Save ROI #{target.id}
            </button>
            <button
              type="button"
              disabled={disabled || loading || !draft?.dirty}
              onClick={() => onDiscard(target.id)}
            >
              Discard ROI #{target.id} changes
            </button>
            <span className="draft-notice">
              {draft?.dirty
                ? 'Unsaved changes — captures use the saved ROI.'
                : 'Saved ROI selected.'}
            </span>
          </>
        ) : (
          <button
            type="button"
            disabled={!rectangle || disabled || loading}
            onClick={() => void selector.addSelected()}
          >
            Add drawn ROI
          </button>
        )}
        <span>
          Save to editing profile: {profileName} (#{profileId})
        </span>
      </div>
      {!target && (
        <div
          className="drawn-roi-replacement"
          role="group"
          aria-label="Edit an existing ROI from the drawn rectangle"
        >
          <div className="actions">
            <label>
              Replace existing ROI
              <select
                aria-label="Replace existing ROI"
                value={replacement?.id ?? ''}
                disabled={disabled || loading || regions.length === 0}
                onChange={(event) => selector.changeReplacement(Number(event.target.value))}
              >
                <option value="">Select saved ROI</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    ROI #{region.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!rectangle || !replacement || disabled || loading}
              onClick={selector.applyToExisting}
            >
              Edit drawn ROI
            </button>
          </div>
          <p>
            Use the selected rectangle as the chosen ROI’s draft. Save ROI to apply the change; its
            ID stays the same.
          </p>
        </div>
      )}
    </section>
  )
}
