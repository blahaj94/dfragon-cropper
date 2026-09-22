import { useEffect, useRef, useState } from 'react'
import type { Region, RoiSelection } from '../../shared/contracts'
import { userError } from './errors'
import './roi-preview.css'

type Rectangle = Omit<Region, 'id'>
export type PreviewDraft = { rectangle: Rectangle | null; dirty: boolean; error: string | null }

export function ScreenPreview({
  profileId,
  profileName,
  regions,
  drafts,
  disabled,
  shortcutStatus,
  isTargetAvailable,
  onAdd,
  onRedraw,
  onSave,
  onDiscard,
  onBusyChange,
  onSelectionComplete
}: {
  profileId: number
  profileName: string
  regions: Region[]
  drafts: Record<number, PreviewDraft>
  disabled: boolean
  shortcutStatus: string
  isTargetAvailable: (profileId: number, regionId: number | null) => boolean
  onAdd: (rectangle: Rectangle) => Promise<boolean>
  onRedraw: (profileId: number, regionId: number, rectangle: Rectangle) => void
  onSave: (regionId: number) => Promise<boolean>
  onDiscard: (regionId: number) => void
  onBusyChange: (busy: boolean) => void
  onSelectionComplete: (profileId: number) => void
}) {
  const [selections, setSelections] = useState<Record<number, RoiSelection>>({})
  const [targets, setTargets] = useState<Record<number, number | null>>({})
  const [replacementTargets, setReplacementTargets] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestInFlight = useRef(false)
  const mounted = useRef(true)
  const target = regions.find((region) => region.id === targets[profileId]) ?? null
  const regionId = target?.id ?? null
  const draft = target ? drafts[target.id] : null
  const replacement = regions.find((region) => region.id === replacementTargets[profileId])
  const rectangle = target ? draft?.rectangle : selections[profileId]?.rectangle
  const latest = useRef({ isTargetAvailable, onRedraw, onSelectionComplete, onBusyChange })
  latest.current = { isTargetAvailable, onRedraw, onSelectionComplete, onBusyChange }

  async function select() {
    if (disabled || requestInFlight.current || !isTargetAvailable(profileId, regionId)) return
    const requested = { profileId, regionId }
    requestInFlight.current = true
    setLoading(true)
    setError(null)
    onBusyChange(true)
    try {
      const result = await window.spike.selectRoi()
      if (!result || !mounted.current) return
      if (!latest.current.isTargetAvailable(requested.profileId, requested.regionId)) {
        setError('The selected profile or ROI is no longer available. Select an ROI again.')
        return
      }
      if (requested.regionId === null) {
        setSelections((current) => ({ ...current, [requested.profileId]: result }))
      } else {
        latest.current.onRedraw(requested.profileId, requested.regionId, result.rectangle)
      }
      latest.current.onSelectionComplete(requested.profileId)
    } catch (reason) {
      if (mounted.current) setError(userError(reason))
    } finally {
      requestInFlight.current = false
      if (mounted.current) {
        setLoading(false)
        latest.current.onBusyChange(false)
      }
    }
  }

  const selectRef = useRef(select)
  selectRef.current = select
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.spike.onSelectRoiRequested(() => void selectRef.current())
    return () => {
      mounted.current = false
      unsubscribe()
      if (requestInFlight.current) latest.current.onBusyChange(false)
    }
  }, [])

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
            setTargets((current) => ({
              ...current,
              [profileId]: event.target.value === 'new' ? null : Number(event.target.value)
            }))
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
            onClick={async () => {
              if (rectangle && (await onAdd(rectangle))) {
                setSelections((current) => {
                  const next = { ...current }
                  delete next[profileId]
                  return next
                })
              }
            }}
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
                onChange={(event) =>
                  setReplacementTargets((current) => ({
                    ...current,
                    [profileId]: Number(event.target.value)
                  }))
                }
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
              onClick={() => {
                if (!rectangle || !replacement) return
                onRedraw(profileId, replacement.id, rectangle)
                setTargets((current) => ({ ...current, [profileId]: replacement.id }))
              }}
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
