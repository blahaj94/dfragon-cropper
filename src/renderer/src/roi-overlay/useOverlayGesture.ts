import { useRef, useState, type PointerEvent } from 'react'
import type { PreviewFrame, Region } from '../../../shared/contracts'
import { sourcePoint, selectionRectangle, type Point } from '../selection'

export type OverlayCursor = { client: Point; source: Point }

/** Keep pointer capture and source-space selection separate from session IPC and rendering. */
export function useOverlayGesture({
  frame,
  isFinishing,
  finish,
  clearError
}: {
  frame: PreviewFrame | null
  isFinishing: () => boolean
  finish: (rectangle: Omit<Region, 'id'> | null) => Promise<void>
  clearError: () => void
}) {
  const [ready, setReady] = useState(false)
  const [selection, setSelection] = useState<Omit<Region, 'id'> | null>(null)
  const [cursor, setCursor] = useState<OverlayCursor | null>(null)
  const image = useRef<HTMLImageElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ pointerId: number; start: Point } | null>(null)

  function point(event: PointerEvent<HTMLDivElement>) {
    if (!frame || !ready || !image.current || isFinishing()) return null
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

  return {
    image,
    surface,
    ready,
    cursor,
    selection,
    imageLoaded() {
      setReady(true)
      surface.current?.focus({ preventScroll: true })
    },
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || dragging.current) return
        const start = point(event)
        if (!start) return
        event.preventDefault()
        clearError()
        dragging.current = { pointerId: event.pointerId, start }
        setCursor({ client: { x: event.clientX, y: event.clientY }, source: start })
        setSelection(null)
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const end = point(event)
        if (!end || !frame) return
        setCursor({ client: { x: event.clientX, y: event.clientY }, source: end })
        const drag = dragging.current
        if (drag && drag.pointerId === event.pointerId)
          setSelection(selectionRectangle(drag.start, end, frame))
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        const drag = dragging.current
        if (!drag || drag.pointerId !== event.pointerId || !frame) return
        const end = point(event)
        const rectangle = end ? selectionRectangle(drag.start, end, frame) : null
        cancelDrag()
        if (rectangle) {
          setSelection(rectangle)
          void finish(rectangle)
        }
      },
      onPointerCancel(event: PointerEvent<HTMLDivElement>) {
        if (dragging.current?.pointerId === event.pointerId) cancelDrag()
      },
      onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
        if (dragging.current?.pointerId === event.pointerId) cancelDrag()
      },
      onPointerLeave() {
        if (!dragging.current) setCursor(null)
      }
    }
  }
}
