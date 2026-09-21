import { useRef, useState, type PointerEvent } from 'react'
import type { PreviewFrame, Region } from '../../shared/contracts'
import { selectionRectangle, type Point } from './selection'
import { userError } from './errors'

type Rectangle = Omit<Region, 'id'>

export function ScreenPreview({
  profileId,
  profileName,
  regions,
  disabled,
  onAdd,
  onBusyChange
}: {
  profileId: number
  profileName: string
  regions: Region[]
  disabled: boolean
  onAdd: (rectangle: Rectangle) => Promise<boolean>
  onBusyChange: (busy: boolean) => void
}) {
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [selection, setSelection] = useState<{
    profileId: number
    rectangle: Rectangle | null
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const image = useRef<HTMLImageElement>(null)
  const dragging = useRef<{ pointerId: number; start: Point; profileId: number } | null>(null)
  const rectangle = selection?.profileId === profileId ? selection.rectangle : null

  async function refresh() {
    setLoading(true)
    setError(null)
    onBusyChange(true)
    try {
      setFrame(await window.spike.previewScreen())
      setSelection(null)
    } catch (reason) {
      setError(userError(reason))
    } finally {
      setLoading(false)
      onBusyChange(false)
    }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = dragging.current
    if (!drag || drag.pointerId !== event.pointerId || !image.current || !frame) return
    setSelection({
      profileId: drag.profileId,
      rectangle: selectionRectangle(
        drag.start,
        { x: event.clientX, y: event.clientY },
        image.current.getBoundingClientRect(),
        frame
      )
    })
  }

  return (
    <section className="screen-preview" aria-labelledby="screen-preview-heading">
      <div className="section-heading">
        <div>
          <h3 id="screen-preview-heading">Draw on the primary screen</h3>
          <p>
            Refresh the screen, then drag a rectangle. The app hides briefly while taking the
            preview.
          </p>
        </div>
        <button type="button" disabled={disabled || loading} onClick={() => void refresh()}>
          {loading ? 'Loading screen…' : 'Refresh screen preview'}
        </button>
      </div>
      {error && <p role="alert">Screen preview failed. {error}</p>}
      {frame && (
        <>
          <p>
            {frame.width} × {frame.height} physical pixels · Preview taken{' '}
            {new Date(frame.capturedAt).toLocaleTimeString()}
          </p>
          <div
            className="selection-surface"
            role="group"
            aria-label="Screen selection"
            onPointerDown={(event) => {
              if (event.button !== 0 || disabled || loading || !image.current?.naturalWidth) return
              event.preventDefault()
              dragging.current = {
                pointerId: event.pointerId,
                start: { x: event.clientX, y: event.clientY },
                profileId
              }
              setSelection({ profileId, rectangle: null })
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={move}
            onPointerUp={(event) => {
              if (dragging.current?.pointerId !== event.pointerId) return
              move(event)
              dragging.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              dragging.current = null
              setSelection(null)
            }}
            onLostPointerCapture={() => {
              if (dragging.current) {
                dragging.current = null
                setSelection(null)
              }
            }}
          >
            <img
              ref={image}
              src={frame.dataUrl}
              alt="Primary screen preview"
              data-testid="screen-preview"
              draggable={false}
            />
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${frame.width} ${frame.height}`}
              preserveAspectRatio="none"
            >
              {regions.map((region) => (
                <rect
                  key={region.id}
                  {...{ x: region.x, y: region.y, width: region.width, height: region.height }}
                  className="saved-region"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {rectangle && (
                <rect {...rectangle} className="drawn-region" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          </div>
          <p className="selection-readout" data-testid="drawn-rectangle">
            {rectangle
              ? `X ${rectangle.x} · Y ${rectangle.y} · Width ${rectangle.width} · Height ${rectangle.height} physical pixels`
              : 'Drag a rectangle on the preview to select an ROI.'}
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={!rectangle || disabled || loading}
              onClick={async () => {
                if (rectangle && (await onAdd(rectangle))) setSelection(null)
              }}
            >
              Add drawn ROI
            </button>
            <span>
              Save to editing profile: {profileName} (#{profileId})
            </span>
          </div>
        </>
      )}
    </section>
  )
}
