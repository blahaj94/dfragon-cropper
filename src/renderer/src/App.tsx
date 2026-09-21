import { useEffect, useState } from 'react'
import type { ProfileCommand, SpikeState } from '../../shared/contracts'
import { ProfileEditor, userError } from './ProfileEditor'

export function App() {
  const [state, setState] = useState<SpikeState | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)

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

  const lastCapture = state?.lastCapture
  const error = requestError ?? state?.error
  const activeProfile = state?.settings?.profiles.find(
    (profile) => profile.id === state.settings?.activeProfileId
  )

  async function updateProfiles(command: ProfileCommand): Promise<SpikeState> {
    const next = await window.spike.updateProfiles(command)
    setState(next)
    return next
  }

  return (
    <main>
      <h1>DFragonCropper</h1>
      <h2>Windows Capture Spike</h2>
      <p>Primary monitor · Physical pixel coordinates · Lossless PNG · No mouse cursor</p>

      {state?.mode === 'unsupported' && (
        <p role="note">Screen capture and PrintScreen detection require Windows 10.</p>
      )}
      {state?.mode === 'fixture' && <p role="note">Fixture mode: synthetic test frame.</p>}

      <p data-testid="active-profile">
        Active capture profile:{' '}
        {activeProfile ? `${activeProfile.name} (#${activeProfile.id})` : 'None'}
      </p>
      {activeProfile?.regions.length === 0 && (
        <p>Add an ROI to the active profile to enable capture.</p>
      )}

      <button
        type="button"
        onClick={capture}
        disabled={
          !state ||
          state.busy ||
          profileSaving ||
          state.mode === 'unsupported' ||
          !!state.settingsError ||
          !activeProfile?.regions.length
        }
      >
        {state?.busy ? 'Capturing…' : 'Capture Now'}
      </button>

      <p role="status">{state?.triggerStatus ?? 'Loading capture status…'}</p>
      {error && error !== state?.settingsError && <p role="alert">{error}</p>}

      <ProfileEditor
        settings={state?.settings ?? null}
        settingsError={state?.settingsError ?? null}
        onCommand={updateProfiles}
        onSavingChange={setProfileSaving}
      />

      <section aria-labelledby="last-capture-heading">
        <h2 id="last-capture-heading">Last capture</h2>
        {lastCapture ? (
          <dl>
            {lastCapture.profile && (
              <>
                <dt>Captured profile</dt>
                <dd>
                  {lastCapture.profile.name} (#{lastCapture.profile.id})
                </dd>
              </>
            )}
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
