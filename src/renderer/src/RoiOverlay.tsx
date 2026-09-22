import { useEffect, useState } from 'react'
import { useOverlaySession } from './roi-overlay/useOverlaySession'
import { useOverlayGesture } from './roi-overlay/useOverlayGesture'
import { RoiMagnifier } from './roi-overlay/RoiMagnifier'
import './roi-overlay.css'

export function RoiOverlay() {
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const resize = () => setView({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const session = useOverlaySession()
  const { frame, error, finishing, finish } = session
  const gesture = useOverlayGesture({
    frame,
    finish,
    isFinishing: session.isFinishing,
    clearError: () => session.setError(null)
  })
  const { selection, cursor, ready } = gesture
  const scale = frame ? Math.min(view.width / frame.width, view.height / frame.height) : 1
  const screenWidth = frame ? frame.width * scale : 0
  const screenHeight = frame ? frame.height * scale : 0

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
          ref={gesture.surface}
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
          {...gesture.handlers}
        >
          <img
            ref={gesture.image}
            src={frame.dataUrl}
            alt="Frozen primary screen"
            data-testid="roi-overlay-image"
            draggable={false}
            onLoad={gesture.imageLoaded}
            onError={() => session.setError('The frozen screen image could not be loaded.')}
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
      {frame && ready && cursor && (
        <RoiMagnifier frame={frame} cursor={cursor} selection={selection} view={view} />
      )}
    </div>
  )
}
