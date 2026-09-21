# Verification record — 2026-09-22 KST

This record separates synthetic UI frames, injected Windows keys, physical-key observations and actual screen pixels. Machine addresses, usernames, personal paths and screenshots are not committed. Capture event timestamps use UTC (therefore some IDs begin `20260921` for this KST session).

## Toolchain

| Component            | Version         |
| -------------------- | --------------- |
| Electron             | 44.4.3          |
| electron-vite / Vite | 5.0.0 / 7.3.6   |
| React / React DOM    | 19.3.0          |
| TypeScript           | 5.9.3           |
| Koffi / pngjs        | 3.3.1 / 7.0.0   |
| Vitest / Playwright  | 4.1.11 / 1.63.0 |
| electron-builder     | 26.15.3         |
| ESLint / Prettier    | 9.39.5 / 3.9.8  |

Versions are exact in `package.json` and `package-lock.json`. Vite stays on 7 because electron-vite 5's peer range excludes Vite 8. The reference project's versions and boundaries informed the setup; current compatible runtime versions were checked before installation.

## Windows evidence

Windows 10 Pro x64, OS `10.0.19045`, interactive unlocked console desktop, primary physical resolution **1920 × 1080**, Node 24.21.0. Tests use limited-user interactive tasks; they do not mistake an SSH/session-0 launch for the user's desktop.

| Contract                          | Evidence / result                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron API baseline             | Electron 39.8.10 and 44.4.3: `globalShortcut.register('PrintScreen')` succeeded and fired in background. Both **blocked the default clipboard update** in the registered phase, while the unregistered control updated it.                                                                                                       |
| Native background PrintScreen     | Electron 44.4.3 product hook: PASS with synthetic `keybd_event` and a different foreground process.                                                                                                                                                                                                                              |
| Default behavior with native hook | PASS for this machine's ordinary PrintScreen-to-clipboard behavior. Clipboard sequence advanced and image dimensions were 1920×1080. No explicit clipboard write from the probe.                                                                                                                                                 |
| 20 key events                     | Hook-only probe: 20/20 distinct synthetic down/up presses, exactly one callback per press, separate foreground process throughout.                                                                                                                                                                                               |
| Auto-repeat                       | Four repeated keydowns before release produced one callback; a new press after keyup was recognized.                                                                                                                                                                                                                             |
| Primary source / 100% DPI         | PASS: actual scale 1, native fixture DPI 96, DIP size 1920×1080, PNG 1920×1080. Entire source RGBA buffer exactly equals the native per-pixel pattern.                                                                                                                                                                           |
| ROI / 100% DPI                    | PASS: both differently sized ROIs, including the bottom-right region, exactly equal their physical rectangles in the expected pattern.                                                                                                                                                                                           |
| Cursor exclusion / 100%           | PASS: OS cursor visibly at physical (48,48) inside ROI before and after the one source capture; full source and ROI equal cursor-free expected bytes.                                                                                                                                                                            |
| Lossless PNG / single source      | PASS in the native 100% fixture: PNG decode matches every expected pixel, both ROI decodes match, `sourceCaptureCalls = 1`. Independently covered by deterministic unit tests.                                                                                                                                                   |
| 150% DPI                          | PASS: actual scale 1.5, fixture DPI 144, DIP size 1280×720, source PNG 1920×1080. Entire source and both ROIs exactly match physical pattern bytes; cursor visible at (48,48) before/after; exactly one source call.                                                                                                             |
| Full capture pipeline repeat      | PASS at 150%: actual product button capture plus 20/20 synthetic background PrintScreen captures; 21 unique saved events, each with original + 2 ROI PNGs and metadata. Failed 0, skipped 0, clipboard updated for each press. Save latency 253–319 ms.                                                                          |
| Physical PrintScreen key          | PASS at 100% with user-confirmed physical keyboard presses at ≥2-second spacing. The manual branch performed no synthetic injection. 20/20 background captures plus one button capture, failed 0, skipped 0, 21 unique complete saved events; clipboard updated on every press; cleanup confirmed.                               |
| Portable executable               | PASS: actual unsigned portable EXE launched normally; Playwright via loopback CDP clicked Capture Now. Native win32-gdi original (1920×1080) + 2 ROI PNGs decoded correctly and were saved beside the outer EXE, not in extraction storage. Renderer boundary and cleanup passed. Windows Koffi binary is unpacked outside ASAR. |

The first 100% full-pattern comparison was **inconclusive due to fixture occlusion**: an always-on-top Task Manager covered part of the pattern. Both ROI comparisons already passed. The user minimized Task Manager; the unobstructed rerun passed the entire source and both ROIs. The capture backend was unchanged. This was a justified rerun to remove an observed obstruction, not repeated validation of an already established pass.

The first physical-key attempt was stopped when a new press arrived while saving (~0.4 seconds after the first capture began). The user confirmed pressing rapidly. This is the explicit busy-skip limitation, not evidence of duplicate events from one physical press. That attempt is recorded as a failed rapid-input check; it is not counted as a 20-press pass. The listener was unchanged for the successful paced retry. Raw records of both attempts are retained privately; the user restored Windows scale to 100% after the 150% check.

Portable artifact: `DFragonCropper-0.1.0-x64-portable.exe`, 101,064,751 bytes; SHA-256 `136681fa34823e75234a4c56cc137ba1e0baa8e93c4f6d3726022fc8fbaa1caf`. The actual EXE was tested; its binary and all captures remain outside Git. The portable wrapper required normal launch plus renderer CDP automation because direct `_electron.launch()` timed out on the self-extracting launcher. No packaged-app success was inferred from packaging alone.

## Local checks

macOS arm64, Node 24.19.0:

- Installation: PASS; exact dependencies/lockfile, npm audit reported zero vulnerabilities at install time.
- Lint and TypeScript: PASS.
- Unit tests: **18 passed**.
- Playwright: **3 passed**, using a real Electron process with synthetic capture frames for success, failure and unsupported-host paths. Includes IPC push updates and renderer API restriction.
- Electron main/preload/renderer build: PASS.
- Development server boot: PASS; React refresh preamble and Vite WebSocket connected without CSP or runtime errors.
- Formatting check: PASS.

## Remaining limits

This is evidence for the stated Windows desktop and controlled native fixture. It does not guarantee arbitrary games, exclusive fullscreen, protected content, HDR/advanced-color fidelity, locked/UAC desktops, or every PrintScreen mapping/default-action setting. No claim of multi-monitor support is made. Scope remains scaffolding and capture spike.
