import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { GroundTruthCapture, GroundTruthSaveResult } from '../../../shared/contracts'
import { userError } from '../errors'

export function useGroundTruthFeed(visible: boolean, protectedKeys: RefObject<Set<string>>) {
  const [events, setEvents] = useState<GroundTruthCapture[]>([])
  const eventsRef = useRef(events)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const cursor = useRef<string | null>(null)
  const initialized = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const versions = useRef(new Map<string, number>())
  const [reloadErrors, setReloadErrors] = useState<Record<string, string | undefined>>({})
  const [reloading, setReloading] = useState<Set<string>>(new Set())

  const publish = useCallback((next: GroundTruthCapture[]) => {
    eventsRef.current = next
    setEvents(next)
  }, [])

  const load = useCallback(
    (refresh = false): Promise<void> => {
      if (inFlight.current) return inFlight.current
      if (!refresh && initialized.current && !cursor.current) return Promise.resolve()
      setLoading(true)
      setError(null)
      const versionAtStart = new Map(versions.current)
      const task = window.spike
        .listGroundTruthCaptures(refresh ? null : cursor.current)
        .then((page) => {
          const merged = new Map(eventsRef.current.map((event) => [event.key, event]))
          for (const incoming of page.events) {
            const existing = merged.get(incoming.key)
            if (
              existing &&
              (protectedKeys.current.has(incoming.key) ||
                versions.current.get(incoming.key) !== versionAtStart.get(incoming.key))
            ) {
              continue
            }
            merged.set(incoming.key, incoming)
          }
          publish(
            [...merged.values()].sort(
              (a, b) =>
                Date.parse(a.capturedAt) - Date.parse(b.capturedAt) ||
                a.eventId.localeCompare(b.eventId) ||
                a.key.localeCompare(b.key)
            )
          )
          initialized.current = true
          cursor.current = page.nextCursor
          setNextCursor(page.nextCursor)
          setSkipped(page.skippedEntries)
        })
        .catch((reason) => setError(userError(reason)))
        .finally(() => {
          inFlight.current = null
          setLoading(false)
        })
      inFlight.current = task
      return task
    },
    [protectedKeys, publish]
  )

  useEffect(() => {
    if (visible && !initialized.current) void load()
  }, [visible, load])

  const applySaved = useCallback(
    (result: GroundTruthSaveResult) => {
      versions.current.set(result.captureKey, (versions.current.get(result.captureKey) ?? 0) + 1)
      publish(
        eventsRef.current.map((event) =>
          event.key === result.captureKey
            ? {
                ...event,
                revision: result.revision,
                regions: event.regions.map((region) =>
                  region.id === result.regionId ? { ...region, text: result.text } : region
                )
              }
            : event
        )
      )
    },
    [publish]
  )

  const reload = useCallback(
    async (key: string) => {
      setReloading((previous) => new Set(previous).add(key))
      setReloadErrors((previous) => ({ ...previous, [key]: undefined }))
      const versionAtStart = versions.current.get(key)
      try {
        const next = await window.spike.readGroundTruthCapture(key)
        if (versions.current.get(key) !== versionAtStart) return
        versions.current.set(key, (versionAtStart ?? 0) + 1)
        publish(eventsRef.current.map((event) => (event.key === key ? next : event)))
      } catch (reason) {
        setReloadErrors((previous) => ({ ...previous, [key]: userError(reason) }))
      } finally {
        setReloading((previous) => {
          const next = new Set(previous)
          next.delete(key)
          return next
        })
      }
    },
    [publish]
  )

  return {
    events,
    eventsRef,
    loading,
    error,
    skipped,
    initialized: initialized.current,
    nextCursor,
    cursor,
    loadMore: () => load(),
    refresh: () => load(true),
    applySaved,
    reload,
    reloadErrors,
    reloading
  }
}
