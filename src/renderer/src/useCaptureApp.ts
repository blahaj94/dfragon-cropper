import { useEffect, useState } from 'react'
import type { ProfileCommand, SpikeState } from '../../shared/contracts'
import { userError } from './errors'

export function useCaptureApp() {
  const [state, setState] = useState<SpikeState | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let receivedUpdate = false
    const unsubscribe = window.spike.onState((next) => {
      receivedUpdate = true
      if (active) setState(next)
    })
    window.spike.getState().then(
      (initial) => {
        if (active && !receivedUpdate) setState(initial)
      },
      (error: unknown) => {
        if (active) setRequestError(userError(error))
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  async function capture() {
    setRequestError(null)
    try {
      setState(await window.spike.captureNow())
    } catch (error) {
      setRequestError(userError(error))
    }
  }

  async function updateProfiles(command: ProfileCommand): Promise<SpikeState> {
    const next = await window.spike.updateProfiles(command)
    setState(next)
    return next
  }

  async function action(run: () => Promise<void>) {
    setRequestError(null)
    try {
      await run()
    } catch (reason) {
      setRequestError(userError(reason))
    }
  }

  return {
    state,
    requestError,
    capture,
    updateProfiles,
    hideToTray: () => action(() => window.spike.minimizeToTray()),
    quit: () => action(() => window.spike.quit()),
    openOutputFolder: () => action(() => window.spike.openCaptureFolder())
  }
}
