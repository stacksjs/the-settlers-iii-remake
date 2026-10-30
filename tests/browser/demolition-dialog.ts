import { closeSharedBrowsers, launch, navigate } from '@stacksjs/testing/browser'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { playUrl, signInCookie } from './session'

// Public Stacks browser API, including actual Shift+Tab and platform select-all
// keys. No page globals, synthetic DOM keyboard events or focus assignments.
const base = process.argv[2] ?? 'http://127.0.0.1:3450/'
const url = playUrl(base)
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'demolition-dialog-'))
const reports: unknown[] = [], media: unknown[] = []
const cases = [{ width: 1280, height: 720, scale: 1, reducedMotion: false }, { width: 812, height: 375, scale: 2, reducedMotion: true }, { width: 320, height: 568, scale: 1, reducedMotion: true }]

try {
  for (const viewport of cases) {
    const { cdp, close } = await launch({ viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale } })
    const session = await signInCookie(base)
    await cdp.send('Network.setCookie', { name: session.name, value: session.value, url: base, httpOnly: true })
    const steps: { action: string, label: string, ok: boolean }[] = []
    let failure: string | null = null, capture: { sha256: string, bytes: number, width: number, height: number } | null = null
    const check = async (label: string, expression: string, timeout = 2000) => {
      const deadline = performance.now() + timeout
      for (;;) {
        if (await cdp.evaluate<boolean>(expression)) { steps.push({ action: 'assert', label, ok: true }); return }
        if (performance.now() >= deadline) { steps.push({ action: 'assert', label, ok: false }); throw new Error(`Demolition dialog: ${label}`) }
        await Bun.sleep(20)
      }
    }
    const key = async (value: string, code: string, virtual: number, modifiers = 0, text?: string, commands?: string[]) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: virtual, modifiers, ...(text ? { text, unmodifiedText: text } : {}), ...(commands ? { commands } : {}) })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: virtual })
      steps.push({ action: 'key', label: `${modifiers === 8 ? 'Shift+' : modifiers ? 'Select-all modifier+' : ''}${value}`, ok: true })
    }
    const click = async (selector: string) => {
      const p = await cdp.evaluate<{ x: number, y: number }>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw new Error('Missing enabled control'); el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(); if (!r.width || !r.height) throw new Error('Control is hidden'); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
      steps.push({ action: 'click', label: selector, ok: true })
    }
    const focused = (selector: string) => `document.activeElement === document.querySelector(${JSON.stringify(selector)})`
    const shown = `(() => { const el=document.querySelector('.demolition-dialog'); return !!el && getComputedStyle(el).display !== 'none' && el.getAttribute('aria-modal') === 'true'; })()`
    const closed = `!(${shown})`
    const intact = `document.querySelector('.settlement-count').textContent === '2 buildings' && document.querySelector('.inspector h2')?.textContent === 'Sawmill'`
    try {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: viewport.reducedMotion ? 'reduce' : 'no-preference' }] })
      if (!await navigate(cdp, url)) throw new Error('Production page did not settle')
      await check('production settlement ready', `!!document.querySelector('.new-island:not(:disabled)')`, 30000)
      await check('real device scale and motion preference', `devicePixelRatio === ${viewport.scale} && matchMedia('(prefers-reduced-motion: reduce)').matches === ${viewport.reducedMotion}`)
      await click('[aria-label="Pause or resume simulation"]')
      await click('.building-choice[title^="Turns log "]')
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('unfinished site selected', intact)
      const before = await cdp.evaluate<string>(`JSON.stringify({time:document.querySelector('.day').textContent,stocks:document.querySelector('.stocks').textContent,worker:document.querySelector('.inspector .worker-line')?.textContent,message:document.querySelector('[role=status]').textContent})`)
      await click('.tear-down')
      await check('named confirmation preserves unfinished building', `(${shown}) && (${intact}) && (() => { const d=document.querySelector('.demolition-dialog'); return document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim() === 'Tear down Sawmill?'; })()`)
      await check('safe action receives focus', focused('.keep-building'))
      await key('Tab', 'Tab', 9, 8)
      await check('Shift+Tab wraps to confirmation inside modal', focused('.confirm-demolition'))
      await key('Tab', 'Tab', 9)
      await check('Tab wraps to safe action', focused('.keep-building'))
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('cancel preserves site and restores opener', `(${closed}) && (${intact}) && (${focused('.tear-down')})`)
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('keyboard reopens confirmation', `(${shown}) && (${focused('.keep-building')})`)
      await key('Escape', 'Escape', 27)
      await check('Escape preserves site and restores opener', `(${closed}) && (${intact}) && (${focused('.tear-down')})`)
      await click('.tear-down')
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 })
      steps.push({ action: 'click', label: 'native backdrop at 5,5', ok: true })
      await check('backdrop preserves site and restores opener', `(${closed}) && (${intact}) && (${focused('.tear-down')})`)
      await check('all cancellation paths preserve paused time, stock, worker and dispatch', `JSON.stringify({time:document.querySelector('.day').textContent,stocks:document.querySelector('.stocks').textContent,worker:document.querySelector('.inspector .worker-line')?.textContent,message:document.querySelector('[role=status]').textContent}) === ${JSON.stringify(before)}`)
      await click('.tear-down')
      await check('panel and controls fit the actual viewport', `(() => { const p=document.querySelector('.demolition-panel').getBoundingClientRect(); return p.top>=0 && p.left>=0 && p.bottom<=innerHeight+1 && p.right<=innerWidth+1 && [...document.querySelectorAll('.demolition-panel button')].every(b=>{const r=b.getBoundingClientRect();return r.top>=p.top && r.bottom<=p.bottom && r.left>=p.left && r.right<=p.right;}); })()`)
      const screenshot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const bytes = Buffer.from(screenshot.data, 'base64')
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== viewport.width * viewport.scale || bytes.readUInt32BE(20) !== viewport.height * viewport.scale) throw new Error('Confirmation capture has invalid dimensions')
      await writeFile(resolve(directory, `${viewport.width}x${viewport.height}.png`), bytes)
      capture = { sha256: Bun.SHA256.hash(bytes, 'hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      await click('.confirm-demolition')
      await check('confirmation removes only the site and focuses the map', `(${closed}) && document.querySelector('.settlement-count').textContent === '1 building' && !document.querySelector('.inspector h2') && (${focused('.island-map')})`)
      await check('confirmed order receives checkpoint acknowledgement', `document.querySelector('[role=status]').textContent === 'Settlement saved on this device.'`)
      if (!await navigate(cdp, url)) throw new Error('Reload did not settle')
      await check('demolition checkpoint survives reload', `!!document.querySelector('.new-island:not(:disabled)') && document.querySelector('.settlement-count').textContent === '1 building' && (${closed})`, 30000)
      await click('.building-choice[title^="Turns log "]')
      await key('Enter', 'Enter', 13, 0, '\r')
      await click('.map-controls button:last-child')
      await check('real construction assigns the completed workplace worker', `document.querySelector('.inspector .worker-line')?.textContent.includes('sawyer #')`, 30000)
      await click('[aria-label="Pause or resume simulation"]')
      await click('.tear-down')
      await check('completed building also requires confirmation', `(${shown}) && (${intact}) && (${focused('.keep-building')})`)
      await click('.confirm-demolition')
      await check('completed building is removed and saved', `(${closed}) && document.querySelector('.settlement-count').textContent === '1 building' && document.querySelector('[role=status]').textContent === 'Settlement saved on this device.'`)
      if (!await navigate(cdp, url)) throw new Error('Completed demolition reload did not settle')
      await check('completed demolition checkpoint survives reload', `!!document.querySelector('.new-island:not(:disabled)') && document.querySelector('.settlement-count').textContent === '1 building' && (${closed})`, 30000)
      if (cdp.errors.length) throw new Error('Confirmation browser recorded console, request or protocol errors')
    }
    catch (error) {
      const state = await cdp.evaluate(`(() => ({active:document.activeElement?.className,title:document.querySelector('.inspector h2')?.textContent,status:document.querySelector('.inspector .building-status')?.textContent,message:document.querySelector('[role=status]')?.textContent}))()`).catch(() => null)
      failure = `${String(error)}; ${JSON.stringify(state)}`
    }
    finally {
      reports.push({ viewport, ok: failure === null, error: failure, steps, errors: [...cdp.errors] })
      media.push({ viewport, screenshot: capture })
      await writeFile(resolve(shots, 'demolition-dialog.json'), `${JSON.stringify(reports, null, 2)}\n`)
      await writeFile(resolve(shots, 'demolition-dialog-media.json'), `${JSON.stringify({ schemaVersion: 1, captures: media, rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
      await close()
    }
    if (failure) throw new Error(failure)
    console.log(`Demolition confirmation, cancellation, native focus and checkpoint checks passed at ${viewport.width}x${viewport.height}, scale ${viewport.scale}.`)
  }
}
finally { await closeSharedBrowsers() }
