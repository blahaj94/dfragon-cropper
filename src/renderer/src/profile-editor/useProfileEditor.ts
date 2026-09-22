import { useState } from 'react'
import type { ProfileCommand, ProfileSettings, Region, SpikeState } from '../../../shared/contracts'
import { userError } from '../errors'
import {
  draftFrom,
  emptyRectangle,
  previewDraft,
  rectangleFrom,
  type PreviewDraft,
  type Rectangle,
  type RectangleDraft
} from './rectangle-draft'

export interface ProfileEditorInputs {
  settings: ProfileSettings | null
  settingsError: string | null
  onCommand: (command: ProfileCommand) => Promise<SpikeState>
  onSavingChange: (saving: boolean) => void
  onPreviewBusyChange: (busy: boolean) => void
  onSelectionComplete: () => void
}

/** Own editing selection, unsaved drafts and the explicit command/save lifecycle. */
export function useProfileEditor({
  settings,
  settingsError,
  onCommand,
  onSavingChange,
  onPreviewBusyChange,
  onSelectionComplete
}: ProfileEditorInputs) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [names, setNames] = useState<Record<number, string>>({})
  // Drafts belong to immutable profile/ROI IDs, not pushed capture state or mounted forms.
  const [rectangles, setRectangles] = useState<Record<string, RectangleDraft>>({})
  const [saving, setSaving] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const selected =
    settings?.profiles.find((profile) => profile.id === selectedId) ??
    settings?.profiles.find((profile) => profile.id === settings.activeProfileId) ??
    settings?.profiles[0]
  const previewDrafts: Record<number, PreviewDraft> = {}
  const regionDraft = (region: Region) =>
    rectangles[`${selected!.id}:${region.id}`] ?? draftFrom(region)
  for (const region of selected?.regions ?? [])
    previewDrafts[region.id] = previewDraft(regionDraft(region), region)
  const name = selected ? (names[selected.id] ?? selected.name) : ''
  const nameDirty =
    !!selected && names[selected.id] !== undefined && names[selected.id] !== selected.name
  const newRectangle = rectangles[`${selected?.id}:new`] ?? emptyRectangle

  function discardRectangle(key: string) {
    setRectangles((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  async function save(
    command: ProfileCommand | (() => ProfileCommand),
    message: string,
    onSaved?: (state: SpikeState) => void
  ) {
    if (settingsError || saving || selecting) return false
    setError(null)
    setNotice('')
    setSaving(true)
    onSavingChange(true)
    try {
      const next = await onCommand(typeof command === 'function' ? command() : command)
      onSaved?.(next)
      setNotice(message)
      return true
    } catch (reason) {
      setError(`Changes were not saved. ${userError(reason)}`)
      return false
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }

  function createProfile() {
    const knownIds = new Set(settings?.profiles.map((profile) => profile.id))
    return save(
      { type: 'create-profile', name: newName },
      'Profile created and active for captures.',
      (next) => {
        const created = next.settings?.profiles.find((profile) => !knownIds.has(profile.id))
        if (created) setSelectedId(created.id)
        setNewName('')
      }
    )
  }

  function discardName() {
    if (!selected) return
    setNames((current) => {
      const next = { ...current }
      delete next[selected.id]
      return next
    })
    setError(null)
  }

  function saveName() {
    if (!selected) return Promise.resolve(false)
    return save(
      { type: 'rename-profile', profileId: selected.id, name },
      'Profile name saved.',
      discardName
    )
  }

  function saveRegion(regionId: number) {
    const region = selected?.regions.find((region) => region.id === regionId)
    if (!selected || !region) return Promise.resolve(false)
    const key = `${selected.id}:${region.id}`
    return save(
      () => ({
        type: 'update-region',
        profileId: selected.id,
        regionId: region.id,
        rectangle: rectangleFrom(rectangles[key] ?? draftFrom(region))
      }),
      `ROI #${region.id} saved.`,
      () => discardRectangle(key)
    )
  }

  function addNumericRegion() {
    if (!selected) return Promise.resolve(false)
    const key = `${selected.id}:new`
    return save(
      () => ({
        type: 'add-region',
        profileId: selected.id,
        rectangle: rectangleFrom(rectangles[key] ?? emptyRectangle)
      }),
      'ROI added.',
      () => discardRectangle(key)
    )
  }

  function deleteRegion(regionId: number) {
    if (!selected) return Promise.resolve(false)
    return save(
      { type: 'delete-region', profileId: selected.id, regionId },
      `ROI #${regionId} deleted.`,
      () => discardRectangle(`${selected.id}:${regionId}`)
    )
  }

  function isTargetAvailable(profileId: number, regionId: number | null) {
    if (settingsError) return false
    const profile = settings?.profiles.find((profile) => profile.id === profileId)
    return (
      !!profile && (regionId === null || profile.regions.some((region) => region.id === regionId))
    )
  }

  function stageRegion(profileId: number, regionId: number, rectangle: Rectangle) {
    if (
      !settings?.profiles
        .find((profile) => profile.id === profileId)
        ?.regions.some((region) => region.id === regionId)
    )
      return
    setRectangles((current) => ({ ...current, [`${profileId}:${regionId}`]: draftFrom(rectangle) }))
  }

  return {
    selected,
    newName,
    setNewName,
    name,
    nameDirty,
    saving,
    selecting,
    error,
    notice,
    regionDraft,
    newRectangle,
    previewDrafts,
    createProfile,
    discardName,
    saveName,
    saveRegion,
    addNumericRegion,
    deleteRegion,
    isTargetAvailable,
    stageRegion,
    selectProfile(profileId: number) {
      setSelectedId(profileId)
      setError(null)
      setNotice('')
    },
    changeName(value: string) {
      if (selected) setNames({ ...names, [selected.id]: value })
    },
    changeRegion(regionId: number | 'new', draft: RectangleDraft) {
      if (selected) setRectangles({ ...rectangles, [`${selected.id}:${regionId}`]: draft })
    },
    discardRegion(regionId: number) {
      if (selected) discardRectangle(`${selected.id}:${regionId}`)
    },
    activateProfile() {
      return selected
        ? save(
            { type: 'activate-profile', profileId: selected.id },
            'Active capture profile saved.'
          )
        : Promise.resolve(false)
    },
    deleteProfile() {
      return selected
        ? save({ type: 'delete-profile', profileId: selected.id }, 'Profile deleted.')
        : Promise.resolve(false)
    },
    addDrawnRegion(rectangle: Rectangle) {
      return selected
        ? save({ type: 'add-region', profileId: selected.id, rectangle }, 'Drawn ROI saved.')
        : Promise.resolve(false)
    },
    selectionBusyChanged(busy: boolean) {
      setSelecting(busy)
      onPreviewBusyChange(busy)
    },
    selectionCompleted(profileId: number) {
      setSelectedId(profileId)
      onSelectionComplete()
    }
  }
}
