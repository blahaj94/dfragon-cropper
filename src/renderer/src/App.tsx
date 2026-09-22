import { useState } from 'react'
import { ProfileEditor } from './ProfileEditor'
import { CaptureHistory } from './CaptureHistory'
import { Preferences } from './Preferences'
import { useCaptureApp } from './useCaptureApp'

export function App() {
  const { state, requestError, capture, updateProfiles, hideToTray, quit, openOutputFolder } =
    useCaptureApp()
  const [profileSaving, setProfileSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [tab, setTab] = useState<'Profiles' | 'Captures' | 'Settings'>('Profiles')

  const lastCapture = state?.lastCapture
  const error = requestError ?? state?.error
  const activeProfile = state?.settings?.profiles.find(
    (profile) => profile.id === state.settings?.activeProfileId
  )

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>DFragonCropper</h1>
          <p>Primary monitor · Physical pixels · Lossless PNG</p>
        </div>
        <div className="actions">
          <button
            type="button"
            disabled={!state?.backgroundAvailable || state.busy || previewing}
            onClick={() => void hideToTray()}
          >
            Hide to tray
          </button>
          <button
            type="button"
            disabled={state?.busy || profileSaving || previewing}
            onClick={() => void quit()}
          >
            Quit
          </button>
        </div>
      </header>

      {state?.mode === 'unsupported' && (
        <p role="note">Screen capture and PrintScreen detection require Windows 10.</p>
      )}
      {state?.mode === 'fixture' && <p role="note">Fixture mode: synthetic test frame.</p>}

      <section className="capture-toolbar" aria-label="Capture controls">
        <div>
          <p data-testid="active-profile">
            Active capture profile:{' '}
            {activeProfile ? `${activeProfile.name} (#${activeProfile.id})` : 'None'}
          </p>
          {activeProfile?.regions.length === 0 && (
            <p>Add an ROI to the active profile to enable capture.</p>
          )}
        </div>
        <div className="actions">
          <button
            className="primary-button"
            type="button"
            onClick={capture}
            disabled={
              !state ||
              state.busy ||
              profileSaving ||
              previewing ||
              state.mode === 'unsupported' ||
              !!state.settingsError ||
              !activeProfile?.regions.length
            }
          >
            {state?.busy && !previewing ? 'Capturing…' : 'Capture Now'}
          </button>
          <button
            type="button"
            disabled={!state?.outputDirectory}
            onClick={() => void openOutputFolder()}
          >
            Open output folder
          </button>
        </div>
      </section>

      <p role="status">{state?.triggerStatus ?? 'Loading capture status…'}</p>
      {state?.settingsError && (
        <p role="alert">
          Configuration needs attention. {state.settingsError} Captures and editing are paused; any
          unsaved edits are kept until you close the app. Close the app before checking config.json
          or restoring a valid backup, then restart.
        </p>
      )}
      {error && error !== state?.settingsError && <p role="alert">{error}</p>}

      <nav className="tabs" role="tablist" aria-label="Workspace">
        {(['Profiles', 'Captures', 'Settings'] as const).map((name, index, tabs) => (
          <button
            key={name}
            id={`tab-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? tabs[(index + 1) % tabs.length]
                  : event.key === 'ArrowLeft'
                    ? tabs[(index + tabs.length - 1) % tabs.length]
                    : event.key === 'Home'
                      ? tabs[0]
                      : event.key === 'End'
                        ? tabs[tabs.length - 1]
                        : undefined
              if (next) {
                event.preventDefault()
                setTab(next)
                document.getElementById(`tab-${next}`)?.focus()
              }
            }}
          >
            {name}
          </button>
        ))}
      </nav>

      <div
        role="tabpanel"
        id="panel-Profiles"
        aria-labelledby="tab-Profiles"
        hidden={tab !== 'Profiles'}
      >
        <ProfileEditor
          settings={state?.settings ?? null}
          settingsError={state?.settingsError ?? null}
          onCommand={updateProfiles}
          onSavingChange={setProfileSaving}
          previewDisabled={!state || state.busy || profileSaving || state.mode === 'unsupported'}
          onPreviewBusyChange={setPreviewing}
          selectionShortcutStatus={state?.selectionShortcutStatus ?? 'Loading F12 status…'}
          onSelectionComplete={() => setTab('Profiles')}
        />

        <section aria-labelledby="last-capture-heading" className="last-capture">
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
      </div>
      <div
        role="tabpanel"
        id="panel-Captures"
        aria-labelledby="tab-Captures"
        hidden={tab !== 'Captures'}
      >
        <CaptureHistory visible={tab === 'Captures'} lastEventId={lastCapture?.eventId} />
      </div>
      <div
        role="tabpanel"
        id="panel-Settings"
        aria-labelledby="tab-Settings"
        hidden={tab !== 'Settings'}
      >
        <Preferences
          settings={state?.settings ?? null}
          blocked={!!state?.settingsError || previewing}
          outputDirectory={state?.outputDirectory ?? ''}
          backgroundAvailable={state?.backgroundAvailable ?? false}
          onCommand={updateProfiles}
          onSavingChange={setProfileSaving}
        />
      </div>

      <p data-testid="capture-counters">
        Completed: {state?.completed ?? 0} · Failed: {state?.failed ?? 0} · Skipped while busy:{' '}
        {state?.skipped ?? 0}
      </p>
    </main>
  )
}
