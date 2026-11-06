import { closeSharedBrowsers, launch, navigate, waitFor } from '@stacksjs/testing/browser'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import type { InputTraceReport } from './input-trace'
import { traceInput } from './input-trace'

// The public front door, driven through the real browser with real pointer and
// keyboard input: a signed-out visitor plays the guest demo, the game page
// stays behind sign-in, and a new visitor can create an account from the form
// and land in the game.
const base = process.argv[2] ?? 'http://127.0.0.1:3450/'
const at = (path: string): string => new URL(path, base).href
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const steps: { action: string, label: string, ok: boolean }[] = []
const viewports: { width: number, overflow: number }[] = []
const inputEvents: { type: string, trusted: boolean, pointerType: string | null, target: string, prevented: boolean, cancelable: boolean, focused: boolean, pointerId: number, captured: boolean }[] = []
const touchTargets: { x: number, y: number, target: string | null, scrollY: number, scale: number }[] = []
const appearances: { mode: string, background: string, luminance: number, contrast: number }[] = []
const stamp = Date.now().toString(36)
const account = { name: 'Home Check', email: `home-check-${stamp}@example.test`, password: `Home-Check-${stamp}-9!` }

const placementAttempts: { pan: number, x: number, y: number, message: string, tile: string | null }[] = []
const expectedErrorIndexes = new Set<number>()
const failedRequests: { url: string, status: number }[] = []
let inputTrace: InputTraceReport | undefined
let stopInputTrace: (() => Promise<void>) | undefined
const { cdp, close } = await launch({ viewport: { width: 1280, height: 900, deviceScaleFactor: 1 } })
const browser = await cdp.send('Browser.getVersion')
await cdp.send('Runtime.addBinding', { name: 'homeInputObserved' })
cdp.on('Runtime.bindingCalled', ({ name, payload }: { name: string, payload: string }) => { if (name === 'homeInputObserved') inputEvents.push(JSON.parse(payload)) })
cdp.on('Network.responseReceived', ({ response }: { response: { url: string, status: number } }) => { if (response.status >= 400) failedRequests.push({ url: response.url, status: response.status }) })
const check = async (label: string, expression: string, timeout = 5000): Promise<void> => {
  const deadline = performance.now() + timeout
  for (;;) {
    if (await cdp.evaluate<boolean>(expression)) { steps.push({ action: 'assert', label, ok: true }); return }
    if (performance.now() >= deadline) { steps.push({ action: 'assert', label, ok: false }); throw new Error(`Home page: ${label}`) }
    await Bun.sleep(50)
  }
}
const appearance = async (mode: string): Promise<void> => {
  const value = await cdp.evaluate<{ background: string, luminance: number, contrast: number }>(`(() => {
    const style = getComputedStyle(document.body), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const luminance = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 };
    const bg = luminance(style.backgroundColor), fg = luminance(style.color);
    return { background: style.backgroundColor, luminance: bg, contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) };
  })()`)
  appearances.push({ mode, ...value })
}
const point = async (selector: string): Promise<{ x: number, y: number }> => cdp.evaluate<{ x: number, y: number }>(`(async () => {
  const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw new Error('Missing enabled control ${selector.replace(/'/g, '')}')
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  // Match the Stacks driver's compositor synchronization after scrolling.
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  const r = el.getBoundingClientRect(); const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)), y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)); const hit = document.elementFromPoint(x, y); if (!hit || !el.contains(hit)) throw new Error('Control is obscured ${selector.replace(/'/g, '')}'); return { x, y }
})()`)
const click = async (selector: string): Promise<void> => {
  const p = await point(selector)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
  steps.push({ action: 'click', label: selector, ok: true })
}
const key = async (value: string, code: string, virtual: number, text?: string): Promise<void> => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: virtual, ...(text ? { text, unmodifiedText: text } : {}) })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: virtual })
}
const type = async (selector: string, text: string): Promise<void> => {
  await click(selector)
  await cdp.send('Input.insertText', { text })
  steps.push({ action: 'type', label: selector, ok: true })
}

try {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  // A transient asset failure must recover through the visible retry action.
  // Only the first request fails; the retry must fetch the real assets and run
  // the real engine. No page signals, module functions or saved world are injected.
  for (const [label, pattern] of [
    ['manifest', '*/assets/settlers-original/manifest.json'],
    ['atlas', '*/assets/settlers-original/sprites.*.png'],
  ]) {
    const errorsBefore = cdp.errors.length
    let requests = 0
    const requestCount = (): number => requests
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    const stop = await cdp.intercept([{ urlPattern: pattern, requestStage: 'Request' }], async request => {
      requests++
      await cdp.send(requests === 1 ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
        requestId: request.requestId,
        ...(requests === 1 ? { errorReason: 'InternetDisconnected' } : {}),
      })
    })
    try {
      if (!await navigate(cdp, base)) throw new Error('The failure scenario did not settle')
      await check(`${label} failure is visible`, `!document.querySelector('#start-demo').disabled && /missing|fetch|load|decode/i.test(document.querySelector('#demo-message').textContent)`, 15000)
      await waitFor(() => cdp.errors.length >= errorsBefore + 2, 5000, { label: `${label} controlled request failure diagnostics` })
      const errors = cdp.errors.slice(errorsBefore)
      const expected = ['Network: net::ERR_INTERNET_DISCONNECTED', 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED']
      if (errors.length !== 2 || !expected.every(error => errors.includes(error))) throw new Error(`Unexpected errors during ${label} failure: ${JSON.stringify(errors)}`)
      errors.forEach((_, index) => expectedErrorIndexes.add(errorsBefore + index))
      if (requestCount() !== 1) throw new Error(`Expected one failed ${label} request, got ${requests}`)
      await click('#start-demo')
      await check(`${label} retry loads real starting goods and enables construction`, `document.querySelector('#demo-stock').textContent.includes('plank 30') && ![...document.querySelectorAll('[role=toolbar] button')].some(b => b.disabled)`, 60000)
      if (requestCount() !== 2) throw new Error(`Expected exactly one fresh ${label} retry, got ${requests}`)
      await click('[role=toolbar] button:nth-child(1)')
      await key('Enter', 'Enter', 13, '\\r')
      await check(`${label} recovery places a site`, `/site placed/.test(document.querySelector('#demo-message').textContent)`)
      await check(`${label} recovery keeps guest progress out of saved settlements`, `!Object.keys(localStorage).some(k => k.includes('gold-checkpoint'))`)
    }
    finally { await stop() }
  }
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })

  // 1. A signed-out visitor plays the guest demo.
  if (!await navigate(cdp, base)) throw new Error('The home page did not settle')
  await check('the home page offers the demo without signing in', `!!document.querySelector('#demo-map') && !document.cookie.includes('auth-token')`)
  await check('the demo starts by itself, without signing in, and shows its starting goods', `document.querySelector('#demo-stock').textContent.includes('plank 30') && ![...document.querySelectorAll('[role=toolbar] button')].some(b => b.disabled)`, 60000)
  const stock = await cdp.evaluate<string>(`document.querySelector('#demo-stock').textContent`)
  const over = await point('#demo-map')
  const before = await cdp.evaluate<number>(`scrollY`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...over, deltaX: 0, deltaY: 120 })
  await check('the page scrolled past the map', `scrollY > ${before}`)
  await click('[role=toolbar] button:nth-child(1)')
  await check('the woodcutter tool is pressed', `document.querySelector('[role=toolbar] button:nth-child(1)').getAttribute('aria-pressed') === 'true'`)
  // Choosing a tool hands keyboard focus to the map, and Enter places at the cursor the tool chose.
  await check('choosing a tool hands keyboard focus to the map', `document.activeElement === document.querySelector('#demo-map')`)
  await key('Enter', 'Enter', 13, '\r')
  await check('the engine placed a woodcutter site from the keyboard', `document.querySelector('#demo-message').textContent.includes('site placed')`, 10000)
  await click('[aria-label="Game speed"] button:last-child')
  await check('the settlers built it and spent real planks and stone', `(() => { const t = document.querySelector('#demo-stock').textContent; const plank = Number(/plank (\\d+)/.exec(t)?.[1] ?? 99); return plank < 30 && /\\b[2-9] buildings/.test(document.querySelector('#demo-message').parentElement.textContent) })()`, 90000)
  steps.push({ action: 'assert', label: `starting goods were ${stock}`, ok: true })
  await check('guest play wrote nothing to the signed-in save namespace', `!Object.keys(localStorage).some(k => k.includes('gold-checkpoint'))`)

  // The real guest game also accepts touch on a narrow screen. All taps go
  // through Chrome input, and valid construction must spend actual goods.
  await cdp.evaluate('scrollTo(0, 0)')
  await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 80 }).then(({ data }: { data: string }) => writeFile(resolve(shots, 'home-desktop.webp'), Buffer.from(data, 'base64')))
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  if (!await navigate(cdp, base)) throw new Error('The touch home page did not settle')
  await check('the touch demo boots with real starting goods', `document.querySelector('#demo-stock').textContent.includes('plank 30')`, 60000)
  await check('the page fits a narrow touch viewport', `document.documentElement.scrollWidth <= 390`)
  viewports.push({ width: 390, overflow: await cdp.evaluate<number>('Math.max(0, document.documentElement.scrollWidth - 390)') })
  // Observe real guest input without changing signals, handlers or game state.
  await cdp.evaluate(`['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'click'].forEach(type => document.addEventListener(type, event => {
    const target = event.target.closest?.('button, canvas'); if (!target) return;
    setTimeout(() => homeInputObserved(JSON.stringify({ type, trusted: event.isTrusted, prevented: event.defaultPrevented, cancelable: event.cancelable, focused: document.hasFocus(), pointerType: event.pointerType || null, pointerId: event.pointerId, captured: target.hasPointerCapture?.(event.pointerId) || false, target: target.id || target.getAttribute('aria-label') || target.textContent.trim().slice(0, 60) })), 0);
  }, { capture: true, passive: true }))`)
  const tap = async (p: { x: number, y: number }): Promise<void> => {
    touchTargets.push(await cdp.evaluate<{ x: number, y: number, target: string | null, scrollY: number, scale: number }>(`(() => {
      const target = document.elementFromPoint(${p.x}, ${p.y})?.closest('button, canvas');
      return { x: ${p.x}, y: ${p.y}, target: target ? target.id || target.getAttribute('aria-label') || target.textContent.trim().slice(0, 60) : null, scrollY, scale: visualViewport?.scale || 1 };
    })()`))
    // Direct touch input delivers the trusted compatibility click on both
    // host platforms; the synthesized gesture does not on hosted Linux.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await tap(await point('[aria-label="Game speed"] button:first-child'))
  const capture = await traceInput(cdp)
  inputTrace = capture.report
  stopInputTrace = capture.stop
  await point('#demo-map')
  const panStart = await point('#demo-map')
  const beforePan = await cdp.evaluate<string>(`document.querySelector('#demo-map').toDataURL()`)
  const scrollBeforePan = await cdp.evaluate<number>('scrollY')
  const dragMap = async (dx: number, dy: number): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...panStart, id: 1 }] })
    for (const fraction of [1 / 3, 2 / 3, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: panStart.x + dx * fraction, y: panStart.y + dy * fraction, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await dragMap(60, 0)
  await check('a touch drag pans the paused map without scrolling the page', `document.querySelector('#demo-map').toDataURL() !== ${JSON.stringify(beforePan)} && scrollY === ${scrollBeforePan}`)
  await check('panning places no building', `/1 building/.test(document.querySelector('#demo-message').parentElement.textContent)`)
  await tap(await point('[role=toolbar] button:nth-child(1)'))
  await check('touch selects the woodcutter tool', `document.querySelector('[role=toolbar] button:nth-child(1)').getAttribute('aria-pressed') === 'true'`)
  await stopInputTrace()
  if (!inputTrace.complete || inputTrace.error || inputTrace.dataLoss || inputTrace.dropped)
    throw new Error(`Guest input tracing did not stop and drain cleanly: ${JSON.stringify({ complete: inputTrace.complete, error: inputTrace.error, dataLoss: inputTrace.dataLoss, dropped: inputTrace.dropped })}`)
  // Explore visible open ground, as a player does, without calling the renderer
  // or the simulation from the test. The castle itself is an occupied site.
  await point('#demo-map')
  const rect = await cdp.evaluate<{ x: number, y: number, width: number, height: number }>(`(() => { const r = document.querySelector('#demo-map').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  let placed = false
  const searchUntil = performance.now() + 10000
  // A castle can fill a narrow view. If open ground is elsewhere, pan to its
  // other sides instead of assuming one random starting landscape is clear.
  search: for (const [pan, move] of [{ x: 0, y: 0 }, { x: -120, y: 0 }, { x: 60, y: 80 }, { x: 0, y: -160 }].entries()) {
    if (pan) await dragMap(move.x, move.y)
    for (const y of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      for (const x of [0.3, 0.7, 0.5, 0.4, 0.6, 0.2, 0.8, 0.1, 0.9]) {
        if (performance.now() > searchUntil) break search
        await tap({ x: rect.x + rect.width * x, y: rect.y + rect.height * y })
        const feedback = await cdp.evaluate<{ message: string, tile: string | null }>(`({ message: document.querySelector('#demo-message').textContent, tile: document.querySelector('#demo-map').getAttribute('aria-label') })`)
        placementAttempts.push({ pan, x, y, ...feedback })
        placed = /site placed/.test(feedback.message)
        if (placed) break search
      }
    }
  }
  if (!placed) throw new Error('Touch could not place a woodcutter on visible ground')
  steps.push({ action: 'touch', label: 'touch places a real construction site', ok: true })
  await tap(await point('[aria-label="Game speed"] button:last-child'))
  await check('touch construction spends real goods', `(() => { const t = document.querySelector('#demo-stock').textContent; return Number(/plank (\\d+)/.exec(t)?.[1] ?? 99) < 30 && /\\b[2-9] buildings/.test(document.querySelector('#demo-message').parentElement.textContent) })()`, 90000)
  await check('the selected woodcutter is built, not just a counted construction site', `document.querySelector('#demo-building')?.textContent.includes('Woodcutter') && document.querySelector('#demo-building').textContent.includes(': Built.')`, 90000)
  await check('touch play also leaves saved settlements untouched', `!Object.keys(localStorage).some(k => k.includes('gold-checkpoint'))`)
  await cdp.evaluate('scrollTo(0, 0)')
  await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 80 }).then(({ data }: { data: string }) => writeFile(resolve(shots, 'home-mobile.webp'), Buffer.from(data, 'base64')))
  await appearance('light')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
  await check('dark mode follows the system preference on the page', `matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.classList.contains('dark') && getComputedStyle(document.body).backgroundColor !== ${JSON.stringify(appearances[0]!.background)}`)
  await appearance('dark')
  if (appearances[1]!.luminance >= appearances[0]!.luminance || appearances.some(value => value.contrast < 4.5)) throw new Error('Page themes must change brightness and retain readable body text')
  steps.push({ action: 'assert', label: 'both page themes retain readable body text', ok: true })
  await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 80 }).then(({ data }: { data: string }) => writeFile(resolve(shots, 'home-mobile-dark.webp'), Buffer.from(data, 'base64')))
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

  // 2. The full game stays behind sign-in.
  if (!await navigate(cdp, at('play'))) throw new Error('The play page did not settle')
  await check('the game page sends a signed-out visitor to sign in and remembers the way back', `location.pathname === '/login' && /play/.test(location.search)`)

  // 3. A new visitor creates an account from the real form and lands in the game.
  if (!await navigate(cdp, at('register?redirect=/play'))) throw new Error('The register page did not settle')
  await check('the register form is complete', `document.querySelectorAll('form input').length === 5 && !!document.querySelector('form button[type=submit]')`)
  await type('form input[type=text]', account.name)
  await type('form input[type=email]', account.email)
  await cdp.evaluate(`document.querySelectorAll('form input[type=password]')[1].setAttribute('data-check', 'confirm')`)
  await type('form input[type=password]:not([data-check])', account.password)
  await type('[data-check=confirm]', account.password)
  await click('form input[type=checkbox]')
  await check('the form is filled and terms accepted', `document.querySelector('form input[type=checkbox]').checked`)
  await click('form button[type=submit]')
  await check('registration lands the new account in the game', `location.pathname === '/play'`, 30000)
  await check('the signed-in game boots its settlement', `!!document.querySelector('.new-island:not(:disabled)')`, 60000)

  const unexpectedErrors = cdp.errors.filter((_, index) => !expectedErrorIndexes.has(index))
  if (unexpectedErrors.length || failedRequests.length) throw new Error(`Unexpected browser failures: ${JSON.stringify({ unexpectedErrors, failedRequests })}`)
  await check('the favicon fallback is a valid castle image', `(async () => { const image = new Image(); image.src = '/favicon.ico'; await image.decode(); return image.naturalWidth === 32 && image.naturalHeight === 32 })()`)
  await writeFile(resolve(shots, 'home.json'), `${JSON.stringify({ steps, browser, viewports, appearances, inputEvents, inputTrace, touchTargets, placementAttempts, failedRequests, observedConsoleErrors: cdp.errors, expectedFailureErrorCount: expectedErrorIndexes.size, consoleErrors: cdp.errors.filter((_, index) => !expectedErrorIndexes.has(index)) }, null, 2)}\n`)
  console.log('The home page demo, the sign-in gate and real registration passed in the browser.')
}
catch (error) {
  const state = await cdp.evaluate<string>(`JSON.stringify({ path: location.pathname, title: document.title, canvases: document.querySelectorAll('canvas').length, demoMessage: document.querySelector('#demo-message')?.textContent, selectedBuilding: document.querySelector('#demo-building')?.textContent, text: document.body.innerText.slice(0, 300) })`).catch(() => 'unavailable')
  const originalErrors = [...cdp.errors]
  const failure = { steps, browser, viewports, appearances, inputEvents, inputTrace, touchTargets, placementAttempts, failedRequests, observedConsoleErrors: originalErrors, expectedFailureErrorCount: expectedErrorIndexes.size, consoleErrors: originalErrors.filter((_, index) => !expectedErrorIndexes.has(index)), state, error: error instanceof Error ? error.message : String(error) }
  await writeFile(resolve(shots, 'home.json'), `${JSON.stringify(failure, null, 2)}\n`)
  await stopInputTrace?.()
  await writeFile(resolve(shots, 'home.json'), `${JSON.stringify(failure, null, 2)}\n`)
  throw error
}
finally {
  await close()
  await closeSharedBrowsers()
}
