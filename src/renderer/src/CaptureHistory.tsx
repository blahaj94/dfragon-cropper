import { useEffect, useState } from 'react'
import type { CaptureHistory as History } from '../../shared/contracts'
import { CaptureImagePreview } from './CaptureImagePreview'
import { userError } from './errors'

export function CaptureHistory({
  visible,
  lastEventId
}: {
  visible: boolean
  lastEventId?: string
}) {
  const [history, setHistory] = useState<History | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [asset, setAsset] = useState<{ eventId: string; value: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [image, setImage] = useState<{
    key: string
    url: string | null
    error: string | null
    loading: boolean
  }>({ key: '', url: null, error: null, loading: false })
  const selected =
    history?.events.find((event) => event.eventId === selectedId) ?? history?.events[0]
  const value =
    asset && asset.eventId === selected?.eventId
      ? asset.value
      : selected?.originalSaved !== false
        ? 'original'
        : String(selected?.regions[0]?.id ?? '')
  const eventId = selected?.eventId
  const imageKey = `${eventId ?? ''}:${value}:${revision}`
  // Effects run after rendering. Match the result to this selection during render
  // so an earlier image can never appear under the newly selected asset's label.
  const currentImage = image.key === imageKey ? image : null

  useEffect(() => {
    if (!visible) return
    let active = true
    setLoading(true)
    setError(null)
    window.spike.listCaptures().then(
      (next) => {
        if (active) {
          setHistory(next)
          setLoading(false)
        }
      },
      (reason) => {
        if (active) {
          setError(userError(reason))
          setLoading(false)
        }
      }
    )
    return () => {
      active = false
    }
  }, [visible, lastEventId, revision])

  useEffect(() => {
    if (!visible || !eventId || !value) return
    let active = true
    setImage({ key: imageKey, url: null, error: null, loading: true })
    window.spike.readCaptureImage(eventId, value === 'original' ? null : Number(value)).then(
      (url) => {
        if (active) setImage({ key: imageKey, url, error: null, loading: false })
      },
      (reason) => {
        if (active) setImage({ key: imageKey, url: null, error: userError(reason), loading: false })
      }
    )
    return () => {
      active = false
    }
  }, [visible, eventId, value, imageKey])

  return (
    <section aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <h2 id="history-heading">Capture history</h2>
          <p>Browse the latest 100 saved events.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRevision(revision + 1)}>
          Refresh history
        </button>
      </div>
      {error && <p role="alert">Could not load capture history. {error}</p>}
      {loading && <p role="status">Loading captures…</p>}
      {history?.hasMore && (
        <p>Showing the latest 100 events. Older captures are available in the output folder.</p>
      )}
      {!!history?.skippedEntries && (
        <p>{history.skippedEntries} unreadable capture entries were skipped.</p>
      )}
      {history?.events.length === 0 && <p>No saved captures yet.</p>}
      {selected && (
        <>
          <div className="history-selectors">
            <label>
              Capture event
              <select
                aria-label="Capture event"
                value={selected.eventId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {history?.events.map((event) => (
                  <option key={event.eventId} value={event.eventId}>
                    {event.eventId} · {event.profile?.name ?? 'Profile'} · {event.regions.length}{' '}
                    ROIs
                  </option>
                ))}
              </select>
            </label>
            <label>
              Capture image
              <select
                aria-label="Capture image"
                value={value}
                onChange={(event) =>
                  setAsset({ eventId: selected.eventId, value: event.target.value })
                }
              >
                {selected.originalSaved !== false && (
                  <option value="original">Original frame</option>
                )}
                {selected.regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    ROI #{region.id} · {region.width} × {region.height}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <p>
              {selected.width} × {selected.height} source pixels · {selected.trigger} ·{' '}
              {new Date(selected.capturedAt).toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() =>
                window.spike
                  .openCaptureFolder(selected.eventId)
                  .catch((reason) => setError(userError(reason)))
              }
            >
              Open capture folder
            </button>
          </div>
          {selected.originalSaved === false && (
            <p>Original image was not saved for this capture.</p>
          )}
          {(!currentImage || currentImage.loading) && <p role="status">Loading image…</p>}
          {currentImage?.error && (
            <p role="alert">Could not open the capture image. {currentImage.error}</p>
          )}
          <CaptureImagePreview
            imageKey={imageKey}
            url={currentImage?.url ?? null}
            alt={value === 'original' ? 'Original capture' : `ROI #${value} capture`}
          />
        </>
      )}
    </section>
  )
}
