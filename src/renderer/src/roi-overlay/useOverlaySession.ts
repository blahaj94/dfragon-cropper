import { useEffect, useRef, useState } from 'react'
import type { PreviewFrame, Region } from '../../../shared/contracts'
import { userError } from '../errors'

/** Own the ephemeral window's IPC lifecycle; completing a selection never saves a profile. */
export function useOverlaySession() {
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const finishingRef = useRef(false)
  const live = useRef(true)

  async function finish(rectangle: Omit<Region, 'id'> | null) {
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
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void finishRef.current(null)
      }
    }
    window.addEventListener('keydown', keydown)
    window.focus()
    return () => {
      active = false
      live.current = false
      window.removeEventListener('keydown', keydown)
    }
  }, [])

  return { frame, error, setError, finishing, finish, isFinishing: () => finishingRef.current }
}
