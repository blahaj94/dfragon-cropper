import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SpikeState } from '../shared/contracts'

/** Resolve process configuration once; packaged apps never accept development fixtures. */
export function resolveRuntime(options: {
  packaged: boolean
  appPath: string
  bundleDirectory: string
  execPath: string
  platform: string
  environment: NodeJS.ProcessEnv
}) {
  const { appPath, bundleDirectory, environment, platform } = options
  const development = !options.packaged
  const fixture = development ? environment.DFRAGON_FIXTURE : undefined
  const portableRoot = environment.PORTABLE_EXECUTABLE_DIR || dirname(options.execPath)
  const captureRoot = development
    ? environment.DFRAGON_OUTPUT_DIR || join(appPath, '.dev-captures')
    : join(portableRoot, 'captures')
  const mode: SpikeState['mode'] = fixture
    ? 'fixture'
    : platform !== 'win32'
      ? 'unsupported'
      : development && environment.DFRAGON_TRIGGER === 'global-shortcut'
        ? 'global-shortcut'
        : 'keyboard-hook'
  return {
    platform,
    mode,
    development,
    fixture,
    captureRoot,
    captureRoots: development ? [captureRoot] : [captureRoot, join(portableRoot, '.dev-captures')],
    configPath: development
      ? environment.DFRAGON_CONFIG_FILE || join(appPath, '.dev-config', 'config.json')
      : join(portableRoot, 'config.json'),
    logDirectory: development ? join(appPath, '.dev-logs') : join(portableRoot, 'logs'),
    stateFile: development ? environment.DFRAGON_STATE_FILE : undefined,
    userData: development ? environment.DFRAGON_USER_DATA : undefined,
    preload: join(bundleDirectory, '../preload/index.js'),
    documentUrl:
      development && environment.ELECTRON_RENDERER_URL
        ? new URL(environment.ELECTRON_RENDERER_URL).href
        : pathToFileURL(join(bundleDirectory, '../renderer/index.html')).href
  }
}
