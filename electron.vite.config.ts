import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        input: {
          index: resolve('src/main/index.ts'),
          printscreen: resolve('src/main/printscreen.ts'),
          'windows-check': resolve('spike/windows-capture/windows-check.ts')
        }
      }
    }
  },
  preload: { build: { externalizeDeps: false } },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml: (html) =>
          html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      },
      react()
    ]
  }
})
