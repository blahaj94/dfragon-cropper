if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error(
    'Run npm ci and npm run build:win on Windows x64 to include the Windows Koffi binary.'
  )
  process.exit(1)
}
