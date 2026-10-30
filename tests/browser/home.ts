import { closeSharedBrowsers, launch, navigate } from '@stacksjs/testing/browser'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

// The public front door, driven through the real browser with real pointer and
// keyboard input: a signed-out visitor plays the guest demo, the game page
// stays behind sign-in, and a new visitor can create an account from the form
// and land in the game.
const base = process.argv[2] ?? 'http://127.0.0.1:3450/'
const at = (path: string): string => new URL(path, base).href
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const steps: { action: string, label: string, ok: boolean }[] = []
const stamp = Date.now().toString(36)
const account = { name: 'Home Check', email: `home-check-${stamp}@example.test`, password: `Home-Check-${stamp}-9!` }

const { cdp, close } = await launch({ viewport: { width: 1280, height: 900, deviceScaleFactor: 1 } })
const check = async (label: string, expression: string, timeout = 5000): Promise<void> => {
  const deadline = performance.now() + timeout
  for (;;) {
    if (await cdp.evaluate<boolean>(expression)) { steps.push({ action: 'assert', label, ok: true }); return }
    if (performance.now() >= deadline) { steps.push({ action: 'assert', label, ok: false }); throw new Error(`Home page: ${label}`) }
    await Bun.sleep(50)
  }
}
const point = async (selector: string): Promise<{ x: number, y: number }> => cdp.evaluate<{ x: number, y: number }>(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw new Error('Missing enabled control ${selector.replace(/'/g, '')}')
  el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
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

  await writeFile(resolve(shots, 'home.json'), `${JSON.stringify({ steps }, null, 2)}\n`)
  console.log('The home page demo, the sign-in gate and real registration passed in the browser.')
}
catch (error) {
  const state = await cdp.evaluate<string>(`JSON.stringify({ path: location.pathname, title: document.title, canvases: document.querySelectorAll('canvas').length, text: document.body.innerText.slice(0, 300) })`).catch(() => 'unavailable')
  await writeFile(resolve(shots, 'home.json'), `${JSON.stringify({ steps, state, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
  throw error
}
finally {
  await close()
  await closeSharedBrowsers()
}
