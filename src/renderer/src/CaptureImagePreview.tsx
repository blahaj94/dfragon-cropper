import { useLayoutEffect, useRef, useState } from 'react'
import './history-preview.css'

export function CaptureImagePreview({
  imageKey,
  url,
  alt
}: {
  imageKey: string
  url: string | null
  alt: string
}) {
  const [mode, setMode] = useState<'fit' | 'actual'>('fit')
  const [loaded, setLoaded] = useState<{
    key: string
    width: number
    height: number
    error: boolean
  } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const dimensions = loaded?.key === imageKey && url ? loaded : null

  useLayoutEffect(() => {
    viewport.current?.scrollTo(0, 0)
  }, [imageKey, mode])

  return (
    <div className="capture-image-preview">
      <div className="capture-image-controls" role="group" aria-label="Image zoom">
        <button type="button" aria-pressed={mode === 'fit'} onClick={() => setMode('fit')}>
          Fit
        </button>
        <button type="button" aria-pressed={mode === 'actual'} onClick={() => setMode('actual')}>
          100%
        </button>
        {dimensions && !dimensions.error && (
          <span data-testid="history-image-dimensions">
            {dimensions.width} × {dimensions.height} image pixels
          </span>
        )}
      </div>
      <p id="history-zoom-help" className="capture-image-help">
        {mode === 'actual'
          ? '100%: Original image size. Scroll to inspect the image.'
          : 'Fit: the whole image fits within the preview.'}{' '}
        Display scaling does not change the saved PNG. Windows display scaling may change its size
        on screen.
      </p>
      {dimensions?.error && <p role="alert">Could not display the capture image.</p>}
      <div
        ref={viewport}
        className={`capture-image-viewport capture-image-viewport--${mode}`}
        role="region"
        aria-label="Capture image preview"
        aria-describedby="history-zoom-help"
        tabIndex={0}
        hidden={!url}
      >
        {url && (
          <img
            key={imageKey}
            src={url}
            alt={alt}
            data-testid="history-image"
            draggable={false}
            onLoad={(event) =>
              setLoaded({
                key: imageKey,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
                error: false
              })
            }
            onError={() => setLoaded({ key: imageKey, width: 0, height: 0, error: true })}
          />
        )}
      </div>
    </div>
  )
}
