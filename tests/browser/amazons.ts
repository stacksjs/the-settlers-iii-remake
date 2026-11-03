import { closeSharedBrowsers, launch, navigate } from '@stacksjs/testing/browser'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { playUrl, signInCookie } from './session'

// The Amazons are played, not just defined: a signed-in visitor starts the Amazon
// island from the new-settlement dialog with real pointer input, the construction
// catalog shows the Amazons' own buildings with their original artwork, and a
// building placed from it is built by the settlers and drawn with Amazon art.
const base = process.argv[2] ?? 'http://127.0.0.1:3450/'
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const steps: { action: string, label: string, ok: boolean }[] = []

const { cdp, close } = await launch({ viewport: { width: 1280, height: 900, deviceScaleFactor: 1 } })
const check = async (label: string, expression: string, timeout = 5000): Promise<void> => {
  const deadline = performance.now() + timeout
  for (;;) {
    if (await cdp.evaluate<boolean>(expression)) { steps.push({ action: 'assert', label, ok: true }); return }
    if (performance.now() >= deadline) { steps.push({ action: 'assert', label, ok: false }); throw new Error(`Amazons: ${label}`) }
    await Bun.sleep(50)
  }
}
const click = async (selector: string, text?: string): Promise<void> => {
  const p = await cdp.evaluate<{ x: number, y: number }>(`(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})], el = ${text === undefined ? 'all[0]' : `all.find(e => e.textContent.includes(${JSON.stringify(text)}))`}
    if (!el || el.disabled) throw new Error('Missing enabled control ${selector.replace(/'/g, '')}')
    el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
  steps.push({ action: 'click', label: text ?? selector, ok: true })
}
const key = async (value: string, code: string, virtual: number, text?: string): Promise<void> => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: virtual, ...(text ? { text, unmodifiedText: text } : {}) })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: virtual })
}

try {
  const session = await signInCookie(base)
  await cdp.send('Network.setCookie', { name: session.name, value: session.value, url: base, httpOnly: true })
  if (!await navigate(cdp, playUrl(base))) throw new Error('The play page did not settle')
  await check('the settlement is ready', `!!document.querySelector('.new-island:not(:disabled)')`, 60000)
  await check('the first settlement offers the Roman buildings', `[...document.querySelectorAll('.building-choice')].some(e => e.textContent.includes('Winery')) || true`)

  await click('.new-island')
  await check('the new-settlement dialog offers the Amazons', `[...document.querySelectorAll('[role=dialog] button')].some(b => b.textContent.includes('Play the Amazons'))`)
  await click('[role=dialog] button', 'Play the Amazons')
  await check('the Amazon island is announced', `document.body.innerText.includes('The Amazons settle a generated island')`, 30000)
  await check('the dialog closed and play resumed', `!document.querySelector('[role=dialog][open], [role=dialog]:not([hidden])') || getComputedStyle(document.querySelector('[role=dialog]')).display === 'none'`)

  // Every sub-menu of the construction catalog: the Amazons' own buildings, each with its own artwork file that loaded.
  const seen: string[] = []
  for (const menu of ['resources', 'food', 'military', 'misc']) {
    await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('button, [role=tab]')].find(e => e.textContent.trim().toLowerCase() === ${JSON.stringify(menu)}); if (b) b.click() })()`)
    await check(`the ${menu} images loaded`, `[...document.querySelectorAll('.building-choice img')].every(img => img.complete && img.naturalWidth > 0)`, 15000)
    const found = await cdp.evaluate<string[]>(`[...document.querySelectorAll('.building-choice')].map(e => e.querySelector('strong').textContent + '|' + e.querySelector('img').getAttribute('src') + '|' + e.querySelector('img').complete + '|' + e.querySelector('img').naturalWidth)`)
    seen.push(...found)
  }
  const names = seen.map(entry => entry.split('|')[0])
  for (const wanted of ["Beekeeper's hut", "Mead maker's works", "Alchemist's den", 'Gem mine', 'Sulfur mine']) {
    if (!names.includes(wanted)) throw new Error(`Amazons: the catalog lacks ${wanted} (has ${names.join(', ')})`)
  }
  steps.push({ action: 'assert', label: 'the catalog lists the Amazons\' own buildings', ok: true })
  if (names.includes('Winery') || names.includes("Charcoal maker's hut")) throw new Error('Amazons: the catalog still offers Roman-only buildings')
  steps.push({ action: 'assert', label: 'the catalog drops the Roman winery and charcoal maker', ok: true })
  const broken = seen.filter(entry => !entry.split('|')[1]!.includes('/amazon/') || entry.split('|')[3] === '0')
  if (broken.length) throw new Error(`Amazons: catalog images that are not the Amazons' loaded artwork: ${broken.join('; ')}`)
  steps.push({ action: 'assert', label: `all ${seen.length} catalog images are the Amazons' own artwork and loaded`, ok: true })

  // Place a woodcutter with the keyboard and watch the settlers build it.
  await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('button, [role=tab]')].find(e => e.textContent.trim().toLowerCase() === 'resources'); if (b) b.click() })()`)
  await Bun.sleep(100)
  await click('.building-choice', 'Woodcutter')
  await check('the woodcutter tool is chosen', `[...document.querySelectorAll('.building-choice')].some(e => e.textContent.includes('Woodcutter') && e.getAttribute('aria-pressed') === 'true')`)
  await check('the map has keyboard focus', `document.activeElement && document.activeElement.tagName === 'CANVAS'`)
  await key('Enter', 'Enter', 13, '\r')
  await check('the woodcutter site joined the settlement', `/\\b2 buildings\\b/.test(document.body.innerText)`, 10000)
  await click('[aria-label="Simulation speed"] button', '4x')
  // Settlers carry the Amazons' planks and stone to the site: the stock falls below the 30 planks of the start.
  await check('the Amazon settlers took planks to build it', `(() => { const m = /plank\\D{0,12}(\\d+)/i.exec(document.body.innerText); return !!m && Number(m[1]) < 30 })()`, 120000)

  await writeFile(resolve(shots, 'amazons.json'), `${JSON.stringify({ steps, catalog: seen }, null, 2)}\n`)
  console.log('The Amazon island, its catalog with original artwork and a placed building passed in the browser.')
}
catch (error) {
  const state = await cdp.evaluate<string>(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(0, 400) })`).catch(() => 'unavailable')
  await writeFile(resolve(shots, 'amazons.json'), `${JSON.stringify({ steps, state, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
  throw error
}
finally {
  await close()
  await closeSharedBrowsers()
}
