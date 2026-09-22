import { useEffect, useRef, useState } from 'react'
import { CaptureGroup } from './CaptureGroup'
import { answerKey, useGroundTruthAnswers } from './useGroundTruthAnswers'
import { useGroundTruthFeed } from './useGroundTruthFeed'
import { useGroundTruthNavigation } from './useGroundTruthNavigation'
import './ground-truth.css'

export function GroundTruth({ visible }: { visible: boolean }) {
  const protectedKeys = useRef(new Set<string>())
  const feed = useGroundTruthFeed(visible, protectedKeys)
  const answers = useGroundTruthAnswers(feed.eventsRef, protectedKeys, feed.applySaved)
  const [hideAnswered, setHideAnswered] = useState(false)
  const [showEmpty, setShowEmpty] = useState(true)
  const sentinel = useRef<HTMLDivElement>(null)
  const {
    scrollRoot,
    groups,
    activeKey,
    navigationMessage,
    updateActive,
    registerInput,
    markUnreadable,
    advance,
    jump
  } = useGroundTruthNavigation(visible, feed, answers)

  const displayed = feed.events
    .map((capture) => ({
      capture,
      regions: capture.regions.filter((region) => {
        const draft = answers.drafts[answerKey(capture.key, region.id)]
        return !hideAnswered || region.text == null || draft?.dirty || draft?.saving
      })
    }))
    .filter(({ regions }) => showEmpty || regions.length > 0)

  useEffect(() => {
    if (visible) updateActive()
  }, [visible, feed.events, hideAnswered, showEmpty, answers.drafts, updateActive])

  useEffect(() => {
    if (!visible || feed.loading || feed.error || !feed.nextCursor || !sentinel.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void feed.loadMore()
      },
      { root: scrollRoot.current, rootMargin: '200px 0px' }
    )
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [visible, feed.loading, feed.error, feed.nextCursor, feed.loadMore])

  return (
    <section aria-labelledby="ground-truth-heading" className="ground-truth">
      <div className="section-heading">
        <div>
          <h2 id="ground-truth-heading">Ground truth</h2>
          <p>
            Work through saved ROI images, oldest captures first. Enter saves and moves to the next
            unanswered image.
          </p>
        </div>
        <button type="button" disabled={feed.loading} onClick={() => void feed.refresh()}>
          Refresh captures
        </button>
      </div>
      <div className="ground-truth-filters">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideAnswered}
            onChange={(event) => setHideAnswered(event.target.checked)}
          />
          Hide images with answers
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(event) => setShowEmpty(event.target.checked)}
          />
          Show empty capture headings
        </label>
      </div>
      <p className="ground-truth-help">
        Answers are saved per image in its capture&apos;s metadata.json. Clear the input and save to
        remove an answer. Unsaved changes stay visible. Image zoom changes only the preview.
      </p>
      {feed.error && <p role="alert">Could not load captures. {feed.error}</p>}
      {feed.skipped > 0 && (
        <p>{feed.skipped} unreadable capture entries were skipped while loading this page.</p>
      )}
      {navigationMessage && <p role="status">{navigationMessage}</p>}
      <div className="ground-truth-workspace">
        <nav className="ground-truth-bookmarks" aria-label="Capture bookmarks">
          <strong>Captures · oldest first</strong>
          {displayed.map(({ capture }) => (
            <button
              type="button"
              key={capture.key}
              aria-current={activeKey === capture.key ? 'location' : undefined}
              onClick={() => jump(capture.key)}
            >
              {capture.eventId}
            </button>
          ))}
          {displayed.length === 0 && <p>No capture headings to show.</p>}
        </nav>
        <div
          className="ground-truth-feed"
          data-testid="ground-truth-feed"
          ref={scrollRoot}
          onScroll={updateActive}
          role="region"
          aria-label="Captured images and answers"
          tabIndex={0}
        >
          {displayed.map(({ capture, regions }) => (
            <CaptureGroup
              key={capture.key}
              capture={capture}
              regions={regions}
              drafts={answers.drafts}
              elementRef={(element) => {
                if (element) groups.current.set(capture.key, element)
                else groups.current.delete(capture.key)
              }}
              visible={visible}
              scrollRoot={scrollRoot}
              edit={answers.edit}
              save={answers.save}
              advance={advance}
              registerInput={registerInput}
              markUnreadable={markUnreadable}
              reload={feed.reload}
              reloadError={feed.reloadErrors[capture.key]}
              reloading={feed.reloading.has(capture.key)}
            />
          ))}
          {feed.initialized && feed.events.length === 0 && <p>No saved captures yet.</p>}
          {feed.events.length > 0 && displayed.length === 0 && (
            <p>No images match the current filters.</p>
          )}
          <div ref={sentinel} className="ground-truth-load-more">
            {feed.loading && <p role="status">Loading captures…</p>}
            {feed.nextCursor && (
              <button type="button" disabled={feed.loading} onClick={() => void feed.loadMore()}>
                Load more captures
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
