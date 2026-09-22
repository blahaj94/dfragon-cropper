import { rectangleFields, type RectangleDraft } from './rectangle-draft'

const labels = { x: 'X', y: 'Y', width: 'Width', height: 'Height' }

export function RectangleFields({
  draft,
  onChange
}: {
  draft: RectangleDraft
  onChange: (draft: RectangleDraft) => void
}) {
  return (
    <div className="rectangle-fields">
      {rectangleFields.map((field) => (
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
