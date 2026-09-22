import { PNG } from 'pngjs'
import { roiFilename } from '../filenames'
import { captureRoot, eventTimestamp, readLimited } from './files'
import { loadEvent, positiveInteger } from './metadata'

const MAX_PNG_BYTES = 64 * 1024 * 1024
const MAX_DECODED_BYTES = 256 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export async function readCaptureImage(
  outputRoot: string,
  eventId: string,
  regionId: number | null
): Promise<string> {
  eventTimestamp(eventId)
  if (regionId !== null) positiveInteger(regionId, 'ROI ID')
  const event = await loadEvent(await captureRoot(outputRoot), eventId)
  const region =
    regionId === null ? null : event.summary.regions.find((item) => item.id === regionId)
  if (regionId !== null && !region) throw new Error('ROI does not exist in this capture event.')
  if (regionId === null && !event.summary.originalSaved)
    throw new Error('The original image was not saved for this capture.')
  const width = region?.width ?? event.summary.width
  const height = region?.height ?? event.summary.height
  if (width * height * 4 > MAX_DECODED_BYTES)
    throw new Error('Capture image exceeds the 256 MiB decoded preview limit.')
  const png = await readLimited(
    event.folder,
    region ? roiFilename(region.id) : 'original.png',
    MAX_PNG_BYTES
  )
  // Inspect IHDR before pngjs can allocate/decompress an attacker-controlled image size.
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) !== width ||
    png.readUInt32BE(20) !== height ||
    png[24] !== 8 ||
    png[25] !== 6 ||
    png[26] !== 0 ||
    png[27] !== 0 ||
    // The app writes non-interlaced PNGs. pngjs uses an unbounded inflater for Adam7.
    png[28] !== 0
  ) {
    throw new Error('PNG header or dimensions do not match this capture metadata.')
  }
  const decoded = PNG.sync.read(png)
  if (
    decoded.width !== width ||
    decoded.height !== height ||
    decoded.data.length !== width * height * 4
  ) {
    throw new Error('Decoded PNG dimensions do not match this capture metadata.')
  }
  return `data:image/png;base64,${png.toString('base64')}`
}
