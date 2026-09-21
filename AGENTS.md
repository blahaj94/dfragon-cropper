# Agent instructions

- Read `README.md` and `spike/windows-capture/README.md` first.
- This repository is scaffolding plus a Windows capture spike. Do not expand into profile management, servers, uploads, OCR, authentication, a DB, a generic event bus or a plugin framework without a new request.
- Physical pixel preservation is the core product contract. Never resize, filter, normalize, sharpen, grayscale or use lossy encoding. Crop by copying exact rows from one immutable source frame per event.
- Primary Monitor only, absolute nonnegative physical pixel coordinates. Multi-monitor capture and virtual-screen coordinates are intentionally out of scope. Thread DPI awareness prevents coordinate virtualization; it is not a multi-monitor feature.
- Do not replace the capture or PrintScreen implementation without evidence. Preserve baseline experiments and record the reason for any replacement.
- Never claim native capture, cursor exclusion, DPI behavior or PrintScreen behavior is verified without actual Windows evidence. Label synthetic input and synthetic frames explicitly.
- Prefer reasoning/code inspection for scaffolding and simple changes. Use meaningful unit tests for pixel/data contracts, then Playwright for normal UI, then native fixtures/Windows tests. Repeat verification only for a changed contract or new uncertainty.
- Use Playwright before computer-use for UI. Computer-use is a last resort when scripts, native fixtures and other appropriate methods cannot verify the interaction.
- Keep `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. Renderer only gets named typed preload methods. Validate IPC sender/frame/URL and arguments in main. No renderer filesystem/native API access.
- Native callbacks must promptly pass input onward; keep capture and disk work outside keyboard callbacks. Release native resources and hook registrations on exit.
- Preserve local outputs in ignored `.dev-captures/`. Never commit screenshots, private host names, usernames, absolute personal paths, credentials, keys or environment notes. Local `.codex/` is ignored.
- Use a `codex/` branch. Do not force-push, merge or overwrite unrelated user work.
- Before delivery run install, lint, format check, typecheck, unit tests, Playwright UI tests and Electron build. Record any unavailable check honestly. Windows checks need an interactive desktop; SSH session 0 is not equivalent.
