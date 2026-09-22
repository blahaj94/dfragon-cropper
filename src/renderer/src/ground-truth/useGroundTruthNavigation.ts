import { useCallback, useEffect, useRef, useState } from 'react'
import { answerKey, type useGroundTruthAnswers } from './useGroundTruthAnswers'
import type { useGroundTruthFeed } from './useGroundTruthFeed'

export function useGroundTruthNavigation(
  visible: boolean,
  feed: ReturnType<typeof useGroundTruthFeed>,
  answers: ReturnType<typeof useGroundTruthAnswers>
) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [navigationMessage, setNavigationMessage] = useState('')
  const scrollRoot = useRef<HTMLDivElement>(null)
  const groups = useRef(new Map<string, HTMLElement>())
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const unreadable = useRef(new Set<string>())
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const navigation = useRef(0)

  useEffect(() => {
    if (!visible) navigation.current += 1
  }, [visible])

  const updateActive = useCallback(() => {
    const root = scrollRoot.current
    if (!root) return
    const top = root.getBoundingClientRect().top
    const entry = [...groups.current.entries()].find(
      ([, element]) => element.getBoundingClientRect().bottom > top + 32
    )
    setActiveKey(entry?.[0] ?? null)
  }, [])

  const registerInput = useCallback((key: string, id: number, element: HTMLInputElement | null) => {
    const rowKey = answerKey(key, id)
    if (element) inputs.current.set(rowKey, element)
    else inputs.current.delete(rowKey)
  }, [])

  const markUnreadable = useCallback((key: string, id: number, value: boolean) => {
    const rowKey = answerKey(key, id)
    if (value) unreadable.current.add(rowKey)
    else unreadable.current.delete(rowKey)
  }, [])

  async function advance(captureKey: string, regionId: number, input: HTMLInputElement) {
    const request = ++navigation.current
    setNavigationMessage('')
    const saved = await answers.save(captureKey, regionId)
    if (!saved) return
    let afterCurrent = false
    const currentKey = answerKey(captureKey, regionId)
    const seenCursors = new Set<string>()
    const canAdvance = () =>
      visibleRef.current &&
      request === navigation.current &&
      (document.activeElement === input || document.activeElement === document.body)
    while (canAdvance()) {
      for (const capture of feed.eventsRef.current) {
        for (const region of capture.regions) {
          const key = answerKey(capture.key, region.id)
          if (key === currentKey) {
            afterCurrent = true
            continue
          }
          if (
            !afterCurrent ||
            region.text != null ||
            capture.annotationError ||
            unreadable.current.has(key) ||
            answers.draftsRef.current[key]?.saving
          ) {
            continue
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const next = inputs.current.get(key)
          if (next && !next.disabled && canAdvance()) {
            next.scrollIntoView({ block: 'center' })
            next.focus({ preventScroll: true })
            return
          }
        }
      }
      const cursor = feed.cursor.current
      if (!cursor || seenCursors.has(cursor)) break
      seenCursors.add(cursor)
      await feed.loadMore()
      afterCurrent = false
    }
    if (canAdvance()) setNavigationMessage('No more unanswered images in the loaded captures.')
  }

  function jump(key: string) {
    const group = groups.current.get(key)
    const root = scrollRoot.current
    if (!group || !root) return
    root.scrollTo({
      top: root.scrollTop + group.getBoundingClientRect().top - root.getBoundingClientRect().top,
      behavior: 'smooth'
    })
    setActiveKey(key)
  }

  return {
    scrollRoot,
    groups,
    activeKey,
    navigationMessage,
    updateActive,
    registerInput,
    markUnreadable,
    advance,
    jump
  }
}
