import { useCallback, useState, type RefObject } from 'react'
import { GROUND_TRUTH_TEXT_LIMIT, type GroundTruthCapture } from '../../../shared/contracts'
import { LazyRoiImage } from './LazyRoiImage'
import type { useGroundTruthAnswers } from './useGroundTruthAnswers'

type Answers = ReturnType<typeof useGroundTruthAnswers>

export function AnswerRow({
  capture,
  region,
  draft,
  visible,
  scrollRoot,
  reloading,
  edit,
  save,
  advance,
  registerInput,
  markUnreadable
}: {
  capture: GroundTruthCapture
  region: GroundTruthCapture['regions'][number]
  draft: Answers['drafts'][string] | undefined
  visible: boolean
  scrollRoot: RefObject<HTMLDivElement | null>
  reloading: boolean
  edit: Answers['edit']
  save: Answers['save']
  advance: (captureKey: string, regionId: number, input: HTMLInputElement) => Promise<void>
  registerInput: (key: string, id: number, element: HTMLInputElement | null) => void
  markUnreadable: (key: string, id: number, unreadable: boolean) => void
}) {
  const [unreadable, setUnreadable] = useState(false)
  const onUnreadable = useCallback(
    (value: boolean) => {
      setUnreadable(value)
      markUnreadable(capture.key, region.id, value)
    },
    [capture.key, region.id, markUnreadable]
  )
  const value = draft?.dirty || draft?.saving ? draft.value : (region.text ?? '')
  const blocked = !!capture.annotationError || reloading || unreadable

  return (
    <div
      className="ground-truth-row"
      data-testid="ground-truth-row"
      data-region-id={region.id}
      aria-label={`ROI #${region.id}`}
    >
      <LazyRoiImage
        captureKey={capture.key}
        eventId={capture.eventId}
        region={region}
        visible={visible}
        scrollRoot={scrollRoot}
        onUnreadable={onUnreadable}
      />
      <div className="ground-truth-answer">
        <label>
          Character nickname
          <input
            ref={(element) => registerInput(capture.key, region.id, element)}
            type="text"
            maxLength={GROUND_TRUTH_TEXT_LIMIT}
            value={value}
            disabled={blocked}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => edit(capture.key, region.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) {
                return
              }
              event.preventDefault()
              if (!draft?.saving) void advance(capture.key, region.id, event.currentTarget)
            }}
          />
        </label>
        <div className="ground-truth-save">
          <button
            type="button"
            disabled={blocked || draft?.saving || !draft?.dirty}
            onClick={() => void save(capture.key, region.id)}
          >
            Save
          </button>
          <span role="status" data-testid="ground-truth-answer-status">
            {draft?.saving
              ? 'Saving…'
              : draft?.dirty
                ? 'Unsaved changes'
                : region.text != null
                  ? 'Saved'
                  : 'No answer'}
          </span>
        </div>
        {draft?.error && (
          <p role="alert">
            {draft.error} Your input is kept. If the metadata changed, use Reload saved answers for
            this capture before trying again.
          </p>
        )}
      </div>
    </div>
  )
}
