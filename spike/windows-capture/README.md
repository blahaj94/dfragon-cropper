# Windows capture spike

This directory preserves the implementation decision, runnable experiments and evidence. Do not infer a native pass from the synthetic UI fixture.

## Decisions

1. **Try Electron `globalShortcut` first.** `global-shortcut-probe.cjs` runs a separate foreground process, injects PrintScreen, and records clipboard sequence/image dimensions and callback counts before and after registration. On Windows 10 build 19045 with Electron 39.8.10, registration succeeded and the background callback fired, but the default clipboard update stopped. The unregistered control updated the clipboard. This observed failure justified trying a native pass-through listener.
2. **Win32 `WH_KEYBOARD_LL` through Koffi.** `src/main/printscreen.ts` observes VK_SNAPSHOT, deduplicates repeated key-downs until key-up, always calls `CallNextHookEx`, and schedules the capture notification outside the hook callback. It does not register an exclusive hotkey in normal mode. Installation failure is visible in the UI; the button remains usable. The Electron baseline is still available in development with `DFRAGON_TRIGGER=global-shortcut`.
3. **One primary-display GDI copy.** Electron `desktopCapturer.getSources()` provides scaled thumbnails and does not expose a cursor-exclusion option for this API. It was reviewed, not claimed to have failed a pixel experiment. The selected spike uses `CreateDCW` for the primary display, a top-down 32-bit DIB, one `BitBlt` and `GdiFlush`. No additional screenshot is taken for a region. Native API work is in main; there is no new C++ addon/build system.
4. **Physical pixels.** Within the synchronous native call, scoped thread DPI awareness disables coordinate virtualization and is restored in `finally`. `GetMonitorInfoW` must identify the primary monitor at `(0, 0)`, and its dimensions must equal `EnumDisplaySettingsW` physical mode dimensions. No rounding/scaling/clipping of ROI coordinates is performed. Electron DIP coordinates are not used in capture or crop. A mismatch fails visibly.
5. **Lossless output.** The native BGRX byte layout is reordered into RGBA with opaque alpha; RGB sample values remain unchanged. `pngjs` encodes this buffer and exact row-copy crops. There is no resize, JPEG, canvas, video-stream conversion, smoothing, normalization or image filter. PNG losslessness means decoded pixel equality, not identical compressed bytes.

The reference was `blahaj94/ldb` commit `d70c418cf4bb805915b41f1f8b98d385b45ca09a`, primarily `apps/desktop/electron.vite.config.ts`, preload/main IPC security and `windows-security-native.ts`. Its desktop fixtures use isolated Electron profiles; it has no desktop Playwright suite to copy. This repository instead adds a small real-Electron Playwright suite.

## Run the checks

Run native checks from an **interactive Windows desktop**, with the session unlocked. An SSH process by itself cannot prove interactive capture. `run-interactive.ps1` launches a short-lived, limited-user scheduled task in the logged-in session and cleans up only the task it created. It requires an already logged-in account. Do not launch overlapping foreground fixtures.

From the repository root:

```powershell
npm ci
npm run build
$electron = (Resolve-Path .\node_modules\electron\dist\electron.exe).Path
$probe = (Resolve-Path .\spike\windows-capture\global-shortcut-probe.cjs).Path
$hook = (Resolve-Path .\out\main\printscreen.js).Path
$koffi = (Resolve-Path .\node_modules\koffi).Path
$result = Join-Path $PWD '.dev-captures\verification\shortcut.json'
.\spike\windows-capture\run-interactive.ps1 -ElectronPath $electron -ScriptPath $probe -ResultPath $result -ExtraArguments @('--koffi', $koffi, '--hook', $hook, '--press-count', '20')
```

The comparator deliberately invokes Windows' normal PrintScreen behavior; that updates the user's clipboard just as pressing the key does. It does not explicitly write/clear clipboard content or save it as an image artifact. Clipboard sequence plus image dimensions prove an OS update in the controlled fixture; they do not validate all user-specific Snipping Tool/OneDrive/key-remapping settings. Input injection is labelled synthetic in the report. A separate foreground PID is checked, rather than assuming hidden Electron means background focus.

For pixel/DPI/cursor checks, use a fresh result directory at each **actual Windows display scale**:

```powershell
$pixels = (Resolve-Path .\out\main\windows-check.js).Path
$result = Join-Path $PWD '.dev-captures\verification\scale-100\report.json'
.\spike\windows-capture\run-interactive.ps1 -ElectronPath $electron -ScriptPath $pixels -ResultPath $result -ExtraArguments @('--scale=1')
# Change Windows Settings > System > Display > Scale to 150%, then rerun:
$result = Join-Path $PWD '.dev-captures\verification\scale-150\report.json'
.\spike\windows-capture\run-interactive.ps1 -ElectronPath $electron -ScriptPath $pixels -ResultPath $result -ExtraArguments @('--scale=1.5')
```

The fixture temporarily covers the primary monitor with a native borderless test window containing a deterministic per-pixel pattern. It places a visible cursor over ROI 1, captures via the real backend, decodes the source and both PNG crops, and compares exact bytes against the expected pattern. It closes its window and restores the cursor. The expected scale is checked against Electron's actual display scale; passing a flag never changes or simulates Windows scaling. Generated images/reports remain ignored. Restore the display scale after testing.

The actual app pipeline can be checked with `product-flow-probe.cjs`. It uses Playwright for the real Capture Now button and renderer state, then an independent foreground process while observing 20 PrintScreen-triggered native saves. Pass the Node executable to the generic interactive launcher:

```powershell
$node = (Get-Command node.exe).Source
$flow = (Resolve-Path .\spike\windows-capture\product-flow-probe.cjs).Path
$result = Join-Path $PWD '.dev-captures\verification\product-flow.json'
.\spike\windows-capture\run-interactive.ps1 -ElectronPath $node -ScriptPath $flow -ResultPath $result -ExtraArguments @('--app-root', $PWD.Path, '--press-count', '20') -TimeoutSeconds 90
```

For a physical-key check, add `--manual --ready <fresh-ready-json-path>` to the flow arguments and use `-TimeoutSeconds 210`. Wait for the foreground fixture to instruct you, then press the real PrintScreen key 20 times **at least two seconds apart**, releasing between presses. The manual branch performs no software key injection and times out after 180 seconds. It checks every saved event, background focus, counters and clipboard updates. An operator's confirmation that they used a physical keyboard is recorded separately from telemetry. Alternatively, launch `npm run dev` and observe the counters yourself. Never describe synthetic injection as physical-key evidence.

For the built portable executable, use the separate wrapper-aware smoke test:

```powershell
$portable = (Resolve-Path .\dist\DFragonCropper-0.1.0-x64-portable.exe).Path
$smoke = (Resolve-Path .\spike\windows-capture\portable-smoke.cjs).Path
$result = Join-Path $PWD '.dev-captures\verification\portable.json'
.\spike\windows-capture\run-interactive.ps1 -ElectronPath $node -ScriptPath $smoke -ResultPath $result -ExtraArguments @('--executable-path', $portable) -TimeoutSeconds 90
```

This launches the portable EXE normally, then connects Playwright to a temporary loopback CDP endpoint to click Capture Now and inspect state. It verifies that the real native backend saves PNGs beside the outer portable EXE, closes its own window/processes, and removes its test profile. Direct Playwright `_electron.launch()` on the NSIS self-extracting wrapper timed out in this environment; do not mistake that automation transport failure for proof that the packaged app cannot run. The compiled development app uses `_electron` successfully.

## Evidence

Local synthetic checks passed: 18 unit tests for valid/invalid physical rectangles, asymmetric pixel crops, BGRX conversion, PNG roundtrip, output names, metadata and one source invocation shared by multiple ROIs. The actual Electron Playwright suite passed boot, button, push-state updates, success/failure, unsupported host and narrow renderer API checks. A separate bounded dev boot confirmed the Vite React preamble and development CSP.

Current Windows results and remaining acceptance items are in [results.md](results.md). Raw evidence and PNGs are intentionally untracked.

## Limits and interpretation

- Primary monitor only; secondary monitors are not enumerated/cropped. No virtual-screen or negative ROI coordinate support.
- GDI is a spike choice for windowed/borderless desktop content. Protected surfaces, secure/locked desktops, exclusive fullscreen, HDR/advanced color, application overlays and games with custom cursor rendering need separate evidence. A software cursor painted by a game is part of its pixels and cannot be removed by omitting OS cursor composition.
- A fast hook callback still depends on Electron's Windows message pump. Windows may silently remove a low-level hook when its installing thread is unresponsive. There is no hook recovery/watchdog framework in this spike. Keep synchronous main work bounded; rerun the repeat experiment if pipeline latency grows.
- A capture is sampled when the trigger callback is serviced; this is not a hardware-timestamped frame or a guaranteed atomic GPU presentation boundary.
- While a capture is being saved, another trigger is counted as skipped rather than queued. This is visible in the UI. The 20-press acceptance test is a deliberate-use test, not a stress benchmark.
- Portable output uses the executable directory, which must be writable. No config, atomic `.bak` system, credential storage, uploads or persistent capture history has been added.
- Physical keyboard layout/Fn/PrintScreen mappings and the user's default screenshot action remain OS/environment dependent. Report what was actually tested.

## Primary sources

- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron desktopCapturer thumbnail behavior](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
- [CallNextHookEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-callnexthookex)
- [Koffi callbacks](https://koffi.dev/callbacks)
- [EnumDisplaySettingsW physical dimensions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaysettingsw)
- [Thread DPI context](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext)
- [CreateDIBSection and synchronization](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createdibsection)
- [BitBlt](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt)
