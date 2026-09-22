import { useEffect, useState } from 'react'
import type { CaptureHistory } from '../../shared/contracts'
import { userError } from './errors'

export function useCaptureHistory(visible: boolean, lastEventId?: string) {
  const [history, setHistory] = useState<CaptureHistory | null>(null)
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

  function selectImage(value: string) {
    if (selected) setAsset({ eventId: selected.eventId, value })
  }

  function openSelectedFolder() {
    if (selected) {
      return window.spike
        .openCaptureFolder(selected.eventId)
        .catch((reason) => setError(userError(reason)))
    }
  }

  return {
    history,
    loading,
    error,
    selected,
    value,
    imageKey,
    currentImage,
    selectEvent: setSelectedId,
    selectImage,
    refresh: () => setRevision(revision + 1),
    openSelectedFolder
  }
}
