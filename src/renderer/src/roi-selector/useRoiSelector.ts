import { useEffect, useRef, useState } from 'react'
import type { Region, RoiSelection } from '../../../shared/contracts'
import { userError } from '../errors'
import type { PreviewDraft, Rectangle } from '../profile-editor/rectangle-draft'

export interface RoiSelectorInputs {
  profileId: number
  regions: Region[]
  drafts: Record<number, PreviewDraft>
  disabled: boolean
  isTargetAvailable: (profileId: number, regionId: number | null) => boolean
  onAdd: (rectangle: Rectangle) => Promise<boolean>
  onRedraw: (profileId: number, regionId: number, rectangle: Rectangle) => void
  onBusyChange: (busy: boolean) => void
  onSelectionComplete: (profileId: number) => void
}

/** Route one overlay request to the profile/ROI selected when it began. */
export function useRoiSelector({
  profileId,
  regions,
  drafts,
  disabled,
  isTargetAvailable,
  onAdd,
  onRedraw,
  onBusyChange,
  onSelectionComplete
}: RoiSelectorInputs) {
  const [selections, setSelections] = useState<Record<number, RoiSelection>>({})
  const [targets, setTargets] = useState<Record<number, number | null>>({})
  const [replacementTargets, setReplacementTargets] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestInFlight = useRef(false)
  const mounted = useRef(true)
  const target = regions.find((region) => region.id === targets[profileId]) ?? null
  const regionId = target?.id ?? null
  const draft = target ? drafts[target.id] : null
  const replacement = regions.find((region) => region.id === replacementTargets[profileId])
  const rectangle = target ? draft?.rectangle : selections[profileId]?.rectangle
  const latest = useRef({ isTargetAvailable, onRedraw, onSelectionComplete, onBusyChange })
  latest.current = { isTargetAvailable, onRedraw, onSelectionComplete, onBusyChange }

  async function select() {
    if (disabled || requestInFlight.current || !isTargetAvailable(profileId, regionId)) return
    const requested = { profileId, regionId }
    requestInFlight.current = true
    setLoading(true)
    setError(null)
    onBusyChange(true)
    try {
      const result = await window.spike.selectRoi()
      if (!result || !mounted.current) return
      if (!latest.current.isTargetAvailable(requested.profileId, requested.regionId)) {
        setError('The selected profile or ROI is no longer available. Select an ROI again.')
        return
      }
      if (requested.regionId === null) {
        setSelections((current) => ({ ...current, [requested.profileId]: result }))
      } else {
        latest.current.onRedraw(requested.profileId, requested.regionId, result.rectangle)
      }
      latest.current.onSelectionComplete(requested.profileId)
    } catch (reason) {
      if (mounted.current) setError(userError(reason))
    } finally {
      requestInFlight.current = false
      if (mounted.current) {
        setLoading(false)
        latest.current.onBusyChange(false)
      }
    }
  }

  const selectRef = useRef(select)
  selectRef.current = select
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.spike.onSelectRoiRequested(() => void selectRef.current())
    return () => {
      mounted.current = false
      unsubscribe()
      if (requestInFlight.current) latest.current.onBusyChange(false)
    }
  }, [])

  return {
    target,
    regionId,
    draft,
    replacement,
    rectangle,
    loading,
    error,
    select,
    changeTarget(regionId: number | null) {
      setTargets((current) => ({ ...current, [profileId]: regionId }))
    },
    changeReplacement(regionId: number) {
      setReplacementTargets((current) => ({ ...current, [profileId]: regionId }))
    },
    async addSelected() {
      if (rectangle && (await onAdd(rectangle))) {
        setSelections((current) => {
          const next = { ...current }
          delete next[profileId]
          return next
        })
      }
    },
    applyToExisting() {
      if (!rectangle || !replacement) return
      onRedraw(profileId, replacement.id, rectangle)
      setTargets((current) => ({ ...current, [profileId]: replacement.id }))
    }
  }
}
