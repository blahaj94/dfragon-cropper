import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PreviewFrame, Region } from '../../shared/contracts'
import { sourcePoint, selectionRectangle, type Point } from './selection'
import { userError } from './errors'
import './roi-overlay.css'

type Rectangle = Omit<Region, 'id'>
const magnifier = { width: 160, height: 188, patch: 120, zoom: 8, offset: 20 }

export function RoiOverlay() {
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Rectangle | null>(null)
  const [cursor, setCursor] = useState<{ client: Point; source: Point } | null>(null)
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [finishing, setFinishing] = useState(false)
  const finishingRef = useRef(false)
  const image = useRef<HTMLImageElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ pointerId: number; start: Point } | null>(null)
  const live = useRef(true)

  async function finish(rectangle: Rectangle | null) {
    if (finishingRef.current) return
    finishingRef.current = true
    setFinishing(true)
    try {
      await window.roiOverlay.finish(rectangle)
    } catch (reason) {
      if (live.current) {
        finishingRef.current = false
        setFinishing(false)
        setError(userError(reason))
      }
    }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    live.current = true
    let active = true
    window.roiOverlay.getFrame().then(
      (next) => {
        if (active) setFrame(next)
      },
      (reason: unknown) => {
        if (active) setError(userError(reason))
      }
    )
    const resize = () => setView({ width: window.innerWidth, height: window.innerHeight })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void finishRef.current(null)
      }
    }
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', keydown)
    window.focus()
    return () => {
      active = false
      live.current = false
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', keydown)
    }
  }, [])

  const scale = frame ? Math.min(view.width / frame.width, view.height / frame.height) : 1
  const screenWidth = frame ? frame.width * scale : 0
  const screenHeight = frame ? frame.height * scale : 0

  function point(event: PointerEvent<HTMLDivElement>) {
    if (!frame || !ready || !image.current || finishingRef.current) return null
    return sourcePoint(
      { x: event.clientX, y: event.clientY },
      image.current.getBoundingClientRect(),
      frame
    )
  }

  function cancelDrag() {
    const drag = dragging.current
    dragging.current = null
    setSelection(null)
    if (drag && surface.current?.hasPointerCapture(drag.pointerId))
      surface.current.releasePointerCapture(drag.pointerId)
  }

  const pixel =
    frame && cursor
      ? {
          x: Math.min(frame.width - 1, Math.floor(cursor.source.x)),
          y: Math.min(frame.height - 1, Math.floor(cursor.source.y))
        }
      : null
  const card = cursor
    ? {
        x: Math.max(
          0,
          Math.min(
            view.width - magnifier.width,
            cursor.client.x + magnifier.offset + magnifier.width <= view.width
              ? cursor.client.x + magnifier.offset
              : cursor.client.x - magnifier.offset - magnifier.width
          )
        ),
        y: Math.max(
          0,
          Math.min(
            view.height - magnifier.height,
            cursor.client.y + magnifier.offset + magnifier.height <= view.height
              ? cursor.client.y + magnifier.offset
              : cursor.client.y - magnifier.offset - magnifier.height
          )
        )
      }
    : null

  return (
    <div className="roi-overlay" data-testid="roi-overlay" aria-label="Select a screen region">
      <div className="roi-overlay-hud">
        <span>{finishing ? 'Returning selection…' : 'Drag to select · Esc to cancel'}</span>
        <button type="button" disabled={finishing} onClick={() => void finish(null)}>
          Cancel selection
        </button>
      </div>
      {error && (
        <p className="roi-overlay-error" role="alert">
          ROI selection failed. {error}
        </p>
      )}
      {!frame && !error && (
        <p className="roi-overlay-loading" role="status">
          Preparing the frozen screen…
        </p>
      )}
      {frame && (
        <div
          ref={surface}
          className="roi-overlay-screen"
          style={{
            width: screenWidth,
            height: screenHeight,
            left: (view.width - screenWidth) / 2,
            top: (view.height - screenHeight) / 2
          }}
          role="group"
          aria-label="Screen selection"
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0 || dragging.current) return
            const start = point(event)
            if (!start) return
            event.preventDefault()
            setError(null)
            dragging.current = { pointerId: event.pointerId, start }
            setCursor({ client: { x: event.clientX, y: event.clientY }, source: start })
            setSelection(null)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const end = point(event)
            if (!end) return
            setCursor({ client: { x: event.clientX, y: event.clientY }, source: end })
            const drag = dragging.current
            if (drag && drag.pointerId === event.pointerId)
              setSelection(selectionRectangle(drag.start, end, frame))
          }}
          onPointerUp={(event) => {
            const drag = dragging.current
            if (!drag || drag.pointerId !== event.pointerId) return
            const end = point(event)
            const rectangle = end ? selectionRectangle(drag.start, end, frame) : null
            cancelDrag()
            if (rectangle) {
              setSelection(rectangle)
              void finish(rectangle)
            }
          }}
          onPointerCancel={(event) => {
            if (dragging.current?.pointerId === event.pointerId) cancelDrag()
          }}
          onLostPointerCapture={(event) => {
            if (dragging.current?.pointerId === event.pointerId) cancelDrag()
          }}
          onPointerLeave={() => {
            if (!dragging.current) setCursor(null)
          }}
        >
          <img
            ref={image}
            src={frame.dataUrl}
            alt="Frozen primary screen"
            data-testid="roi-overlay-image"
            draggable={false}
            onLoad={() => {
              setReady(true)
              surface.current?.focus({ preventScroll: true })
            }}
            onError={() => setError('The frozen screen image could not be loaded.')}
          />
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${frame.width} ${frame.height}`}
            preserveAspectRatio="none"
          >
            {selection && (
              <>
                <rect
                  {...selection}
                  className="roi-overlay-selection-shadow"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  {...selection}
                  className="roi-overlay-selection"
                  vectorEffect="non-scaling-stroke"
                  data-testid="roi-overlay-selection"
                />
              </>
            )}
          </svg>
        </div>
      )}
      {frame && ready && cursor && pixel && card && (
        <div
          className="roi-magnifier"
          data-testid="roi-magnifier"
          data-source-x={pixel.x}
          data-source-y={pixel.y}
          style={{
            left: Math.round(card.x),
            top: Math.round(card.y),
            width: magnifier.width,
            height: magnifier.height
          }}
          aria-hidden="true"
        >
          <div
            className="roi-magnifier-pixels"
            data-testid="roi-magnifier-pixels"
            style={{ width: magnifier.patch, height: magnifier.patch }}
          >
            <img
              src={frame.dataUrl}
              alt=""
              draggable={false}
              style={{
                width: frame.width * magnifier.zoom,
                height: frame.height * magnifier.zoom,
                left: magnifier.patch / 2 - (pixel.x + 0.5) * magnifier.zoom,
                top: magnifier.patch / 2 - (pixel.y + 0.5) * magnifier.zoom
              }}
            />
            <div className="roi-magnifier-crosshair" data-testid="roi-magnifier-crosshair" />
          </div>
          <div data-testid="roi-magnifier-position">
            X {pixel.x} · Y {pixel.y} px
          </div>
          <div data-testid="roi-overlay-readout">
            {selection ? `W ${selection.width} · H ${selection.height} px` : 'Drag to select'}
          </div>
        </div>
      )}
    </div>
  )
}
