import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Region } from '../../../shared/contracts'
import { userError } from '../errors'

export function LazyRoiImage({
  captureKey,
  eventId,
  region,
  visible,
  scrollRoot,
  onUnreadable
}: {
  captureKey: string
  eventId: string
  region: Region
  visible: boolean
  scrollRoot: RefObject<HTMLDivElement | null>
  onUnreadable: (unreadable: boolean) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [nearby, setNearby] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [zoom, setZoom] = useState('fit')

  useEffect(() => {
    if (!visible || !container.current) {
      setNearby(false)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '240px 0px'
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [visible, scrollRoot])

  useEffect(() => {
    let active = true
    setUrl(null)
    if (!visible || !nearby) return
    setError(null)
    window.spike.readGroundTruthImage(captureKey, region.id).then(
      (next) => {
        if (!active) return
        setUrl(next)
        onUnreadable(false)
      },
      (reason) => {
        if (!active) return
        setError(userError(reason))
        onUnreadable(true)
      }
    )
    return () => {
      active = false
    }
  }, [captureKey, region.id, nearby, visible, retry, onUnreadable])

  return (
    <div className="ground-truth-image" ref={container}>
      <div className="ground-truth-image-toolbar">
        <span>
          ROI #{region.id} · {region.width} × {region.height}
        </span>
        <select
          aria-label="Image zoom"
          value={zoom}
          onChange={(event) => setZoom(event.target.value)}
        >
          <option value="fit">Fit</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
          <option value="4">400%</option>
        </select>
      </div>
      <div
        className={`ground-truth-image-viewport ${zoom === 'fit' ? 'ground-truth-image-fit' : ''}`}
        tabIndex={0}
        role="region"
        aria-label={`ROI #${region.id} image preview`}
      >
        {url ? (
          <img
            src={url}
            alt={`ROI #${region.id} capture from ${eventId}`}
            data-testid="ground-truth-image"
            draggable={false}
            style={
              zoom === 'fit'
                ? undefined
                : { width: region.width * Number(zoom), height: region.height * Number(zoom) }
            }
            onError={() => {
              setError('Could not display the capture image.')
              setUrl(null)
              onUnreadable(true)
            }}
          />
        ) : (
          <span className="ground-truth-image-placeholder">
            {error ? 'Image unavailable' : nearby && visible ? 'Loading image…' : 'ROI image'}
          </span>
        )}
      </div>
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry image
          </button>
        </div>
      )}
    </div>
  )
}
