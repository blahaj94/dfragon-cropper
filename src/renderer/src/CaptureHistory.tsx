import { CaptureImagePreview } from './CaptureImagePreview'
import { useCaptureHistory } from './useCaptureHistory'

export function CaptureHistory({
  visible,
  lastEventId
}: {
  visible: boolean
  lastEventId?: string
}) {
  const {
    history,
    loading,
    error,
    selected,
    value,
    imageKey,
    currentImage,
    selectEvent,
    selectImage,
    refresh,
    openSelectedFolder
  } = useCaptureHistory(visible, lastEventId)

  return (
    <section aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <h2 id="history-heading">Capture history</h2>
          <p>Browse the latest 100 saved events.</p>
        </div>
        <button type="button" disabled={loading} onClick={refresh}>
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
                onChange={(event) => selectEvent(event.target.value)}
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
                onChange={(event) => selectImage(event.target.value)}
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
            <button type="button" onClick={openSelectedFolder}>
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
