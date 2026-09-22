import type { PreviewFrame, Region } from '../../../shared/contracts'
import type { OverlayCursor } from './useOverlayGesture'

const magnifier = { width: 160, height: 188, patch: 120, zoom: 8, offset: 20 }

/** A display-only sample of the same frozen image, positioned beside the pointer. */
export function RoiMagnifier({
  frame,
  cursor,
  selection,
  view
}: {
  frame: PreviewFrame
  cursor: OverlayCursor
  selection: Omit<Region, 'id'> | null
  view: { width: number; height: number }
}) {
  const pixel = {
    x: Math.min(frame.width - 1, Math.floor(cursor.source.x)),
    y: Math.min(frame.height - 1, Math.floor(cursor.source.y))
  }
  const card = {
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
  return (
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
  )
}
