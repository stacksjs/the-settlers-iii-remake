import { launch } from '@stacksjs/testing/browser'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { signInCookie } from '../tests/browser/session'

/**
 * Captures the browser game for the marketing page through a real signed-in
 * session: ordinary clicks and keys, accelerated simulation, no state injected.
 * The images show original demo art, so the site credits it wherever they appear.
 */
const base = process.argv[2] ?? 'http://127.0.0.1:3450/'
const out = resolve(process.argv[3] ?? 'public/showcase')
await mkdir(out, { recursive: true })

const { cdp, close } = await launch({ viewport: { width: 1440, height: 900, deviceScaleFactor: 1 } })
const session = await signInCookie(base)
await cdp.send('Network.setCookie', { name: session.name, value: session.value, url: base, httpOnly: true })
const wait = (ms: number) => Bun.sleep(ms)
const js = <T>(expression: string) => cdp.evaluate<T>(expression)
const key = async (value: string, code: string, virtual: number, text?: string) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: virtual, ...(text ? { text, unmodifiedText: text } : {}) })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: virtual })
}
const click = async (selector: string) => {
  const p = await js<{ x: number, y: number }>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing ${selector}'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 })
}
const shot = async (name: string) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 86 }) as { data: string }
  await writeFile(resolve(out, `${name}.webp`), Buffer.from(data, 'base64'))
  console.log('captured', name)
}
const choose = (name: string) => js<boolean>(`(() => { const el = [...document.querySelectorAll('.building-choice')].find(el => el.textContent.includes(${JSON.stringify(name)})); if (!el || el.disabled) return false; el.click(); return true })()`)
const place = async (name: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    if (!await choose(name)) { console.log('unavailable', name); return }
    await wait(250)
    await key('Enter', 'Enter', 13, '\r')
    await wait(250)
  }
}
const speed = async (label: string) => { await js(`[...document.querySelectorAll('.speed button, [aria-label*="speed" i] button, button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`) }
const reset = async (choice: string) => {
  await click('.new-island')
  await wait(500)
  await js(`[...document.querySelectorAll('.restart-dialog button')].find(b => b.textContent.includes(${JSON.stringify(choice)}))?.click()`)
  await wait(4000)
}

try {
  await cdp.send('Page.navigate', { url: new URL('play', base).href })
  await wait(6000)
  await speed('1x')
  // A working Roman settlement: lumber, stone and a sawmill, built and staffed by real settlers.
  await place("Woodcutter's hut", 2)
  await place("Forester's hut", 1)
  await place("Stonecutter's hut", 1)
  await place('Sawmill', 1)
  await speed('4x')
  await wait(45000)
  await shot('settlement')
  // The original tutorial map, decoded from the demo.
  await reset('Original tutorial map')
  await speed('1x')
  await wait(2500)
  await shot('tutorial')
  // A computer rival that expands and fights by the same rules.
  await reset('Computer rival')
  await place("Woodcutter's hut", 1)
  await place("Stonecutter's hut", 1)
  await place('Sawmill', 1)
  await speed('4x')
  await wait(30000)
  await shot('rival')
}
finally { await close() }
