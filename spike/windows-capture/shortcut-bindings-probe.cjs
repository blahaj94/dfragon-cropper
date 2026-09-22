/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node/Electron fixture. */
// Native Windows integration with synthetic SendInput only: no physical-key or Windows 10 claim.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const { release, tmpdir } = require('node:os')

const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
const resultPath = argument('--output') ? resolve(argument('--output')) : undefined
const marker = 0x44464352
const keys = { printScreen: 0x2c, barrier: 0x75, f7: 0x76, f8: 0x77, f9: 0x78, f12: 0x7b }
const modifiers = { ctrl: 0xa2, shift: 0xa0 }

async function waitUntil(check, label, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return
    await pause(35)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

function supervise() {
  const workdir = mkdtempSync(join(tmpdir(), 'dfragon-bindings-probe-'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  const child = spawn(
    require('electron'),
    [__filename, '--output', resultPath, '--workdir', workdir],
    { env: environment, stdio: 'inherit' }
  )
  let timedOut = false
  const watchdog = setTimeout(() => {
    timedOut = true
    // Kill only this probe's process tree; never an unrelated desktop application.
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { timeout: 5_000 })
  }, 48_000)
  child.once('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.once('close', (code) => {
    clearTimeout(watchdog)
    rmSync(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    process.exitCode = timedOut ? 1 : (code ?? 1)
    if (timedOut) console.error('Native shortcut probe exceeded its 48 second deadline.')
  })
}

function nativeApi() {
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  return {
    koffi,
    user32,
    getModuleHandle: kernel32.func('void * __stdcall GetModuleHandleW(str16 name)'),
    getLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
    getForeground: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
    getWindowProcess: user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, _Out_ uint32_t *pid)'
    ),
    allowForeground: user32.func('bool __stdcall AllowSetForegroundWindow(uint32_t pid)'),
    getAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int32_t key)'),
    sendInput: user32.func(
      'uint32_t __stdcall SendInput(uint32_t count, void *inputs, int32_t size)'
    ),
    mapVirtualKey: user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t key, uint32_t mode)'),
    clipboardSequence: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    clipboardFormat: user32.func('bool __stdcall IsClipboardFormatAvailable(uint32_t format)')
  }
}

function foregroundPid(api) {
  const pid = [0]
  api.getWindowProcess(api.getForeground(), pid)
  return pid[0]
}

async function witness(app, BrowserWindow, workdir) {
  const api = nativeApi()
  const { koffi, user32 } = api
  const events = []
  let dirty = true
  let observerError
  const keyboardRecord = koffi.struct({
    vkCode: 'uint32_t',
    scanCode: 'uint32_t',
    flags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t'
  })
  const procedure = koffi.proto('__stdcall', null, 'intptr_t', ['int32_t', 'uintptr_t', 'void *'])
  const install = user32.func('__stdcall', 'SetWindowsHookExW', 'void *', [
    'int32_t',
    koffi.pointer(procedure),
    'void *',
    'uint32_t'
  ])
  const next = user32.func(
    'intptr_t __stdcall CallNextHookEx(void *hook, int32_t code, uintptr_t message, void *key)'
  )
  const unhook = user32.func('bool __stdcall UnhookWindowsHookEx(void *hook)')
  const callback = koffi.register((code, message, pointer) => {
    try {
      if (code === 0 && pointer) {
        const input = koffi.decode(pointer, keyboardRecord)
        if (Number(input.dwExtraInfo) === marker && Object.values(keys).includes(input.vkCode)) {
          events.push({
            key: input.vkCode,
            up: Number(message) === 0x101 || Number(message) === 0x105
          })
          dirty = true
        }
      }
    } catch (error) {
      observerError = error.message
      dirty = true
    }
    return next(null, code, message, pointer)
  }, koffi.pointer(procedure))
  const hook = install(13, callback, api.getModuleHandle(null), 0)
  if (!hook) throw new Error(`Witness hook installation failed: ${api.getLastError()}.`)
  const window = new BrowserWindow({
    width: 800,
    height: 450,
    title: 'DFragonCropper synthetic shortcut witness',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<body style="background:#142536;color:white;font:24px system-ui;padding:40px"><h1>Synthetic keyboard fixture</h1><p>A separate background process observes configurable shortcuts.</p><p>No physical keyboard evidence is collected.</p></body>'
      )
  )
  window.show()
  window.focus()
  app.focus({ steal: true })
  const timer = setInterval(() => {
    if (dirty) {
      // Disk work stays outside the low-level keyboard callback.
      writeFileSync(
        join(workdir, 'witness.json'),
        JSON.stringify({ pid: process.pid, events, observerError })
      )
      dirty = false
    }
    if (existsSync(join(workdir, 'stop-witness'))) app.quit()
  }, 35)
  const deadline = setTimeout(() => app.quit(), 40_000)
  app.once('will-quit', () => {
    clearInterval(timer)
    clearTimeout(deadline)
    if (unhook(hook)) koffi.unregister(callback)
  })
}

async function driver(app, workdir) {
  const api = nativeApi()
  const report = {
    schemaVersion: 1,
    experiment: 'configurable-native-shortcuts',
    input: 'Synthetic SendInput; physical keyboard and Windows 10 unverified',
    platform: process.platform,
    release: release(),
    electron: process.versions.electron,
    explicitClipboardWrites: false,
    phases: [],
    passed: false
  }
  const pressed = new Set()
  let child
  let listener
  let childClosed
  let captureCount = 0
  let selectionCount = 0
  const binding = (key, extra = {}) => ({
    key,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    ...extra
  })
  let shortcuts = { capture: binding('PrintScreen'), selectRoi: binding('F12') }
  let latestState = null
  function state() {
    try {
      latestState = JSON.parse(readFileSync(join(workdir, 'witness.json'), 'utf8'))
    } catch {
      // Keep the last complete observation while the other process publishes a new one.
    }
    if (latestState?.observerError) throw new Error(latestState.observerError)
    return latestState
  }
  function inject(key, up = false, cleanup = false) {
    if (!cleanup)
      assert.equal(foregroundPid(api), child.pid, 'Separate witness must stay foreground.')
    // Win64 INPUT is 40 bytes: union offset 8, KEYBDINPUT.dwExtraInfo offset 24.
    // https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-input
    const input = Buffer.alloc(40)
    input.writeUInt32LE(1, 0)
    input.writeUInt16LE(key, 8)
    input.writeUInt16LE(key === keys.printScreen ? 0x37 : api.mapVirtualKey(key, 0), 10)
    input.writeUInt32LE((up ? 2 : 0) | (key === keys.printScreen ? 1 : 0), 12)
    input.writeBigUInt64LE(BigInt(marker), 24)
    const count = api.sendInput(1, input, input.length)
    assert.equal(count, 1, `SendInput failed: ${api.getLastError()}.`)
    if (up) pressed.delete(key)
    else pressed.add(key)
  }
  async function send(key, up = false) {
    inject(key, up)
    await pause(35)
  }
  async function tap(key, repeats = 0) {
    await send(key)
    for (let index = 0; index < repeats; index++) await send(key)
    await send(key, true)
  }
  async function chord(key, callback = () => tap(key)) {
    await send(modifiers.ctrl)
    await send(modifiers.shift)
    await callback()
    await send(modifiers.shift, true)
    await send(modifiers.ctrl, true)
  }
  const pair = (key, repeats = 0) => [
    ...Array.from({ length: repeats + 1 }, () => ({ key, up: false })),
    { key, up: true }
  ]
  async function phase(name, gesture, expected, clipboard = false) {
    const before = {
      capture: captureCount,
      selection: selectionCount,
      events: state().events.length
    }
    const sequence = api.clipboardSequence()
    await gesture()
    await tap(keys.barrier)
    // A forwarded sentinel after each gesture proves the lower observer stayed alive,
    // including phases where the selection key is deliberately absent downstream.
    await waitUntil(
      () =>
        state()
          ?.events.slice(before.events)
          .some((event) => event.key === keys.barrier && event.up),
      'downstream sentinel'
    )
    await pause(80)
    if (clipboard)
      await waitUntil(
        () =>
          api.clipboardSequence() !== sequence &&
          [2, 8, 17].some((format) => api.clipboardFormat(format)),
        'normal PrintScreen clipboard bitmap',
        3_000
      )
    const outcome = {
      name,
      captureDelta: captureCount - before.capture,
      selectionDelta: selectionCount - before.selection,
      forwarded: state()
        .events.slice(before.events)
        .filter((event) => event.key !== keys.barrier),
      background: foregroundPid(api) === child.pid,
      ...(clipboard
        ? {
            clipboardSequenceChanged: api.clipboardSequence() !== sequence,
            clipboardHasBitmap: [2, 8, 17].some((format) => api.clipboardFormat(format))
          }
        : {})
    }
    report.phases.push(outcome)
    assert.equal(outcome.background, true, `${name}: fixture lost foreground.`)
    assert.equal(outcome.captureDelta, expected.capture ?? 0, `${name}: capture count.`)
    assert.equal(outcome.selectionDelta, expected.selection ?? 0, `${name}: selection count.`)
    assert.deepEqual(outcome.forwarded, expected.forwarded ?? [], `${name}: forwarding.`)
  }
  try {
    for (const key of [0x10, 0x11, 0x12, 0x5b, 0x5c]) {
      assert.equal(api.getAsyncKeyState(key) & 0x8000, 0, 'Do not run while a modifier is held.')
    }
    child = spawn(
      process.execPath,
      [__filename, '--output', resultPath, '--workdir', workdir, '--witness'],
      { stdio: 'inherit' }
    )
    if (!child.pid) throw new Error('Could not start the foreground witness.')
    childClosed = new Promise((done) => child.once('close', done))
    api.allowForeground(child.pid)
    await waitUntil(
      () => state()?.pid === child.pid && foregroundPid(api) === child.pid,
      'separate foreground witness',
      10_000
    )
    assert.notEqual(child.pid, process.pid)
    await phase(
      'baseline PrintScreen',
      () => tap(keys.printScreen),
      { forwarded: pair(keys.printScreen) },
      true
    )
    const { startPrintScreenListener } = require(resolve('out/main/printscreen.js'))
    listener = startPrintScreenListener(
      () => captureCount++,
      () => selectionCount++,
      () => shortcuts
    )
    await phase(
      'default background PrintScreen',
      () => tap(keys.printScreen),
      { capture: 1, forwarded: pair(keys.printScreen) },
      true
    )
    await phase('default F12 held-key deduplication', () => tap(keys.f12, 2), { selection: 1 })

    shortcuts = { capture: binding('F9'), selectRoi: binding('F8', { ctrl: true, shift: true }) }
    await phase(
      'old PrintScreen keeps Windows behavior after rebind',
      () => tap(keys.printScreen),
      { forwarded: pair(keys.printScreen) },
      true
    )
    await phase('old F12 forwards after rebind', () => tap(keys.f12), { forwarded: pair(keys.f12) })
    await phase('F9 captures once and forwards every repeat', () => tap(keys.f9, 2), {
      capture: 1,
      forwarded: pair(keys.f9, 2)
    })
    await phase(
      'extra modifier prevents F9 capture',
      async () => {
        await send(modifiers.shift)
        await tap(keys.f9)
        await send(modifiers.shift, true)
      },
      { forwarded: pair(keys.f9) }
    )
    await phase('F8 without modifiers forwards', () => tap(keys.f8), { forwarded: pair(keys.f8) })
    await phase(
      'Ctrl F8 without Shift forwards',
      async () => {
        await send(modifiers.ctrl)
        await tap(keys.f8)
        await send(modifiers.ctrl, true)
      },
      { forwarded: pair(keys.f8) }
    )
    await phase(
      'Ctrl Shift F8 selects once and consumes repeats',
      () => chord(keys.f8, () => tap(keys.f8, 2)),
      { selection: 1 }
    )
    await phase(
      'selection stays consumed after modifier release',
      async () => {
        await send(modifiers.ctrl)
        await send(modifiers.shift)
        await send(keys.f8)
        await send(modifiers.shift, true)
        await send(modifiers.ctrl, true)
        await send(keys.f8)
        await send(keys.f8, true)
      },
      { selection: 1 }
    )
    await phase(
      'selection stays consumed after binding changes while held',
      async () => {
        await send(modifiers.ctrl)
        await send(modifiers.shift)
        await send(keys.f8)
        shortcuts = { ...shortcuts, selectRoi: binding('F7') }
        await send(modifiers.shift, true)
        await send(modifiers.ctrl, true)
        await send(keys.f8)
        await send(keys.f8, true)
      },
      { selection: 1 }
    )
    await phase('released old selection key forwards', () => tap(keys.f8), {
      forwarded: pair(keys.f8)
    })
    await phase('new F7 binding takes effect without reinstalling hook', () => tap(keys.f7), {
      selection: 1
    })
    listener.stop()
    listener.stop()
    listener = undefined
    await phase(
      'stop releases former capture and selection bindings',
      async () => {
        await tap(keys.f9)
        await tap(keys.f7)
      },
      { forwarded: [...pair(keys.f9), ...pair(keys.f7)] }
    )
    report.passed = true
  } catch (error) {
    report.error = error.message
  } finally {
    try {
      listener?.stop()
    } catch (error) {
      report.passed = false
      report.cleanupError = error.message
    }
    // Release only keys this probe successfully pressed, even after a failed assertion.
    for (const key of [...pressed].reverse()) {
      try {
        inject(key, true, true)
      } catch (error) {
        report.passed = false
        report.cleanupError = error.message
      }
    }
    if (child) {
      writeFileSync(join(workdir, 'stop-witness'), '')
      await Promise.race([childClosed, pause(2_000)])
      if (child.exitCode === null) {
        child.kill()
        await Promise.race([childClosed, pause(1_000)])
      }
    }
    report.finishedAt = new Date().toISOString()
    mkdirSync(dirname(resultPath), { recursive: true })
    writeFileSync(resultPath, JSON.stringify(report, null, 2))
    console.log(
      `Native synthetic shortcut probe: ${report.passed ? 'PASS' : 'FAIL'} (${report.phases.length} phases)`
    )
    app.exit(report.passed ? 0 : 1)
  }
}

if (process.platform !== 'win32' || process.arch !== 'x64' || !resultPath) {
  throw new Error('Run on Windows x64: node shortcut-bindings-probe.cjs --output <report.json>')
}
if (!process.versions.electron) supervise()
else {
  const { app, BrowserWindow } = require('electron')
  const workdir = argument('--workdir')
  app.setPath('userData', join(workdir, `profile-${process.pid}`))
  app
    .whenReady()
    .then(() =>
      process.argv.includes('--witness')
        ? witness(app, BrowserWindow, workdir)
        : driver(app, workdir)
    )
    .catch((error) => {
      console.error(error.message)
      app.exit(1)
    })
}
