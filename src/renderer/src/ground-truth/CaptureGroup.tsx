import { useId, type ComponentProps, type Ref } from 'react'
import type { GroundTruthCapture } from '../../../shared/contracts'
import { AnswerRow } from './AnswerRow'
import { answerKey, type useGroundTruthAnswers } from './useGroundTruthAnswers'

type Answers = ReturnType<typeof useGroundTruthAnswers>

export function CaptureGroup({
  capture,
  regions,
  drafts,
  elementRef,
  reload,
  reloadError,
  reloading,
  ...rowProps
}: {
  capture: GroundTruthCapture
  regions: GroundTruthCapture['regions']
  drafts: Answers['drafts']
  elementRef: Ref<HTMLElement>
  reload: (key: string) => Promise<void>
  reloadError?: string
  reloading: boolean
} & Pick<
  ComponentProps<typeof AnswerRow>,
  'visible' | 'scrollRoot' | 'edit' | 'save' | 'advance' | 'registerInput' | 'markUnreadable'
>) {
  const titleId = useId()
  const pending = capture.regions.some(
    (region) => drafts[answerKey(capture.key, region.id)]?.saving
  )
  return (
    <article
      ref={elementRef}
      className="ground-truth-capture"
      data-testid="ground-truth-capture"
      data-capture-key={capture.key}
      data-event-id={capture.eventId}
      aria-labelledby={titleId}
    >
      <header className="ground-truth-group-heading">
        <div>
          <h3 id={titleId}>{capture.eventId}</h3>
          <p>
            {new Date(capture.capturedAt).toLocaleString()}
            {capture.profile && ` · ${capture.profile.name}`} · {regions.length} of{' '}
            {capture.regions.length} images shown
          </p>
        </div>
        <button
          type="button"
          disabled={pending || reloading}
          onClick={() => void reload(capture.key)}
        >
          {reloading ? 'Reloading…' : 'Reload saved answers'}
        </button>
      </header>
      {(capture.annotationError || reloadError) && (
        <p role="alert">{capture.annotationError ?? reloadError}</p>
      )}
      {regions.length === 0 && (
        <p className="ground-truth-empty">No images to show with this filter.</p>
      )}
      {regions.map((region) => (
        <AnswerRow
          key={region.id}
          capture={capture}
          region={region}
          draft={drafts[answerKey(capture.key, region.id)]}
          reloading={reloading}
          {...rowProps}
        />
      ))}
    </article>
  )
}
