import type { Region } from '../../../shared/contracts'
import { RectangleFields } from './RectangleFields'
import type { PreviewDraft, RectangleDraft } from './rectangle-draft'

export function RegionEditor({
  region,
  draft,
  preview,
  onChange,
  onSave,
  onDiscard,
  onDelete
}: {
  region: Region
  draft: RectangleDraft
  preview: PreviewDraft
  onChange: (draft: RectangleDraft) => void
  onSave: () => Promise<boolean>
  onDiscard: () => void
  onDelete: () => Promise<boolean>
}) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void onSave()
      }}
    >
      <fieldset className="region">
        <legend>ROI #{region.id}</legend>
        <RectangleFields draft={draft} onChange={onChange} />
        {preview.dirty && <p className="draft-notice">Unsaved changes</p>}
        {preview.error && <p className="roi-validation">{preview.error}</p>}
        <div className="actions">
          <button type="submit" disabled={!preview.dirty || !!preview.error}>
            Save ROI
          </button>
          <button type="button" disabled={!preview.dirty} onClick={onDiscard}>
            Discard changes
          </button>
          <button type="button" onClick={() => void onDelete()}>
            Delete ROI
          </button>
        </div>
      </fieldset>
    </form>
  )
}
