import { useCallback, useRef, useState, type RefObject } from 'react'
import type { GroundTruthCapture, GroundTruthSaveResult } from '../../../shared/contracts'
import { userError } from '../errors'

interface AnswerDraft {
  value: string
  dirty: boolean
  version: number
  saving: boolean
  error?: string
}

export function answerKey(captureKey: string, regionId: number) {
  return JSON.stringify([captureKey, regionId])
}

export function useGroundTruthAnswers(
  events: RefObject<GroundTruthCapture[]>,
  protectedKeys: RefObject<Set<string>>,
  applySaved: (result: GroundTruthSaveResult) => void
) {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})
  const draftsRef = useRef(drafts)
  const queues = useRef(new Map<string, Promise<unknown>>())

  const write = useCallback(
    (captureKey: string, key: string, next: AnswerDraft) => {
      draftsRef.current = { ...draftsRef.current, [key]: next }
      setDrafts(draftsRef.current)
      const protectedCapture = Object.entries(draftsRef.current).some(
        ([rowKey, draft]) => JSON.parse(rowKey)[0] === captureKey && (draft.dirty || draft.saving)
      )
      if (protectedCapture) protectedKeys.current.add(captureKey)
      else protectedKeys.current.delete(captureKey)
    },
    [protectedKeys]
  )

  const edit = useCallback(
    (captureKey: string, regionId: number, value: string) => {
      const key = answerKey(captureKey, regionId)
      const current = draftsRef.current[key]
      const saved = events.current
        .find((event) => event.key === captureKey)
        ?.regions.find((region) => region.id === regionId)?.text
      write(captureKey, key, {
        value,
        dirty: value !== (saved ?? ''),
        version: (current?.version ?? 0) + 1,
        saving: current?.saving ?? false
      })
    },
    [events, write]
  )

  const save = useCallback(
    (captureKey: string, regionId: number): Promise<boolean> => {
      const key = answerKey(captureKey, regionId)
      const current = draftsRef.current[key]
      if (current?.saving) return Promise.resolve(false)
      const event = events.current.find((item) => item.key === captureKey)
      const region = event?.regions.find((item) => item.id === regionId)
      if (!event || !region || event.annotationError) return Promise.resolve(false)
      const value = current?.dirty ? current.value : (region.text ?? '')
      const version = current?.version ?? 0
      write(captureKey, key, { value, version, dirty: current?.dirty ?? false, saving: true })

      // Each queued row uses the revision from the preceding successful save.
      // A changed file on disk still fails in main and requires explicit reload.
      const pending = queues.current.get(captureKey) ?? Promise.resolve()
      const task = pending.then(async () => {
        try {
          const latest = events.current.find((item) => item.key === captureKey)
          if (!latest || latest.annotationError)
            throw new Error('Reload saved answers to continue.')
          const result = await window.spike.saveGroundTruth({
            captureKey,
            regionId,
            text: value.trim() ? value : null,
            revision: latest.revision
          })
          applySaved(result)
          const draft = draftsRef.current[key]
          if (draft.version === version) {
            write(captureKey, key, {
              value: result.text ?? '',
              version,
              dirty: false,
              saving: false
            })
            return true
          }
          write(captureKey, key, {
            ...draft,
            dirty: draft.value !== (result.text ?? ''),
            saving: false
          })
          return false
        } catch (reason) {
          write(captureKey, key, {
            ...draftsRef.current[key],
            saving: false,
            error: userError(reason)
          })
          return false
        }
      })
      queues.current.set(captureKey, task)
      void task.finally(() => {
        if (queues.current.get(captureKey) === task) queues.current.delete(captureKey)
      })
      return task
    },
    [events, applySaved, write]
  )

  return { drafts, draftsRef, edit, save }
}
