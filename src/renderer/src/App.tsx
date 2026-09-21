import { useEffect, useState } from 'react'
import type { SpikeState } from '../../shared/contracts'

export function App() {
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
        if (active) setRequestError(error instanceof Error ? error.message : String(error))
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
      setRequestError(error instanceof Error ? error.message : String(error))
    }
  }

  const lastCapture = state?.lastCapture
  const error = requestError ?? state?.error

  return (
    <main>
      <h1>DFragonCropper</h1>
      <h2>Windows Capture Spike</h2>
      <p>Primary monitor · Physical pixel coordinates · Lossless PNG · No mouse cursor</p>

      {state?.mode === 'unsupported' && (
        <p role="note">Screen capture and PrintScreen detection require Windows 10.</p>
      )}
      {state?.mode === 'fixture' && <p role="note">Fixture mode: synthetic test frame.</p>}

      <button
        type="button"
        onClick={capture}
        disabled={!state || state.busy || state.mode === 'unsupported'}
      >
        {state?.busy ? 'Capturing…' : 'Capture Now'}
      </button>

      <p role="status">{state?.triggerStatus ?? 'Loading capture status…'}</p>
      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="last-capture-heading">
        <h2 id="last-capture-heading">Last capture</h2>
        {lastCapture ? (
          <dl>
            <dt>Event</dt>
            <dd data-testid="capture-event">{lastCapture.eventId}</dd>
            <dt>Captured at</dt>
            <dd>{lastCapture.capturedAt}</dd>
            <dt>Source frame</dt>
            <dd data-testid="capture-dimensions">
              {lastCapture.width} × {lastCapture.height} physical pixels
            </dd>
            <dt>Trigger</dt>
            <dd>{lastCapture.trigger}</dd>
            <dt>Output directory</dt>
            <dd data-testid="capture-output">{lastCapture.outputDirectory}</dd>
            <dt>Saved regions</dt>
            <dd>{lastCapture.regions.length}</dd>
          </dl>
        ) : (
          <p>Not yet captured</p>
        )}
      </section>

      <p data-testid="capture-counters">
        Completed: {state?.completed ?? 0} · Failed: {state?.failed ?? 0} · Skipped while busy:{' '}
        {state?.skipped ?? 0}
      </p>
    </main>
  )
}
