import { fileURLToPath } from 'node:url'
import { convertIcon } from 'app-builder-lib/out/util/iconConverter.js'

// Use the pinned packaging tool's converter; the supplied PNG remains unchanged.
const resources = fileURLToPath(new URL('../resources/', import.meta.url))
const result = await convertIcon({
  sources: ['icon.png'],
  fallbackSources: [],
  roots: [resources],
  format: 'ico',
  outDir: resources
})
if (result.icons.length !== 1 || result.isFallback) {
  throw new Error('The application icon could not be generated from resources/icon.png.')
}
console.log('Generated resources/icon.ico from resources/icon.png.')
