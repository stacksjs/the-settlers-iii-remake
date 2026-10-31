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
const directory = await mkdtemp(resolve(shots, 'restart-dialog-'))
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
        if (performance.now() >= deadline) { steps.push({ action: 'assert', label, ok: false }); throw new Error(`Restart dialog: ${label}`) }
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
    const input = async (text: string) => { await cdp.send('Input.insertText', { text }); steps.push({ action: 'type', label: text, ok: true }) }
    const focused = (selector: string) => `document.activeElement === document.querySelector(${JSON.stringify(selector)})`
    const shown = `(() => { const el=document.querySelector('[role="dialog"]'); return !!el && getComputedStyle(el).display !== 'none' && el.getAttribute('aria-modal') === 'true'; })()`
    const closed = `!(${shown})`
    try {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: viewport.reducedMotion ? 'reduce' : 'no-preference' }] })
      if (!await navigate(cdp, url)) throw new Error('Production page did not settle')
      await check('production settlement ready', `!!document.querySelector('.new-island:not(:disabled)')`, 30000)
      await check('real device scale and motion preference', `devicePixelRatio === ${viewport.scale} && matchMedia('(prefers-reduced-motion: reduce)').matches === ${viewport.reducedMotion}`)
      await click('[aria-label="Pause or resume simulation"]')
      await check('world paused before confirmation', `document.querySelector('[aria-label="Pause or resume simulation"]').getAttribute('aria-pressed') === 'true'`)
      await click('.new-island')
      await check('named modal dialog', `(${shown}) && (() => { const d=document.querySelector('[role="dialog"]'); return document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim() === 'Start a new settlement?'; })()`)
      await check('seed receives initial focus', focused('#map-seed'))
      await key('Tab', 'Tab', 9, 8)
      await check('Shift+Tab wraps to cancel', focused('.restart-panel .quiet-button'))
      await check('focused cancel is visible on short screens', `(() => { const r=document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight+1 && r.left >= 0 && r.right <= innerWidth+1; })()`)
      await key('Tab', 'Tab', 9)
      await check('Tab wraps back to seed', focused('#map-seed'))
      for (let n = 0; n < 5; n++) await key('Tab', 'Tab', 9)
      await check('forward navigation remains inside dialog', focused('#map-seed'))
      await input('invalid')
      await key('Tab', 'Tab', 9)
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('invalid seed remains in dialog with focused error input', `(${shown}) && (${focused('#map-seed')}) && document.querySelector('#map-seed').getAttribute('aria-invalid') === 'true' && !!document.querySelector('#map-seed-error[role="alert"]')`)
      await check('invalid confirmation did not resume the world', `document.querySelector('[aria-label="Pause or resume simulation"]').getAttribute('aria-pressed') === 'true'`)
      // Chrome's native editing command accompanies the platform shortcut.
      // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
      await key('a', 'KeyA', 65, process.platform === 'darwin' ? 4 : 2, undefined, ['selectAll'])
      await check('native editing command selects the invalid input', `(() => { const input=document.querySelector('#map-seed'); return input.selectionStart===0 && input.selectionEnd===input.value.length; })()`)
      await input('2')
      await check('native select-all replaces the invalid draft', `document.querySelector('#map-seed').value === '2'`)
      await key('Escape', 'Escape', 27)
      await check('Escape closes and restores the opener', `(${closed}) && (${focused('.new-island')}) && document.querySelector('.new-island').getAttribute('aria-expanded') === 'false'`)
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('keyboard reopening restores the draft', `(${shown}) && (${focused('#map-seed')}) && document.querySelector('#map-seed').value === '2'`)
      await key('Tab', 'Tab', 9)
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('new seeded game closes dialog and focuses the map', `(${closed}) && (${focused('.island-map')}) && document.querySelector('.map-seed')?.textContent.includes('2')`, 30000)
      // The restart saves its checkpoint in the background and says so when it is written. Reloading before that
      // acknowledgement races the write on a slow machine, which is not what a person who sees "saved" does.
      await check('the new settlement reports its checkpoint saved', `document.querySelector('[role=status]')?.textContent.includes('Settlement saved on this device.')`, 30000)
      if (!await navigate(cdp, url)) throw new Error('Restored production page did not settle')
      await check('replaced checkpoint restores its new map seed', `!!document.querySelector('.new-island:not(:disabled)') && document.querySelector('.map-seed')?.textContent.includes('2') && (${closed})`, 30000)
      await click('.new-island')
      await check('restored game opens an accessible confirmation', `(${shown}) && (${focused('#map-seed')})`)
      await check('panel stays inside the actual viewport', `(() => { const r=document.querySelector('.restart-panel').getBoundingClientRect(); return r.top>=-1 && r.left>=-1 && r.bottom<=innerHeight+1 && r.right<=innerWidth+1; })()`)
      const screenshot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const bytes = Buffer.from(screenshot.data, 'base64')
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== viewport.width * viewport.scale || bytes.readUInt32BE(20) !== viewport.height * viewport.scale) throw new Error('Confirmation capture has invalid dimensions')
      await writeFile(resolve(directory, `${viewport.width}x${viewport.height}.png`), bytes)
      capture = { sha256: Bun.SHA256.hash(bytes, 'hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      await key('Tab', 'Tab', 9, 8)
      await key('Enter', 'Enter', 13, 0, '\r')
      await check('cancel button closes and restores the opener', `(${closed}) && (${focused('.new-island')})`)
      await click('.new-island')
      await check('confirmation reopens before backdrop dismissal', `(${shown}) && (${focused('#map-seed')})`)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 })
      steps.push({ action: 'click', label: 'backdrop outside the confirmation', ok: true })
      await check('native backdrop click closes and restores the opener', `(${closed}) && (${focused('.new-island')})`)
      if (cdp.errors.length) throw new Error('Confirmation browser recorded console, request or protocol errors')
    }
    catch (error) {
      const state = await cdp.evaluate(`(() => { const seed=document.querySelector('#map-seed'), dialog=document.querySelector('[role="dialog"]'); return { active:document.activeElement?.id || document.activeElement?.className, seed:seed?.value, selection:[seed?.selectionStart,seed?.selectionEnd], display:dialog && getComputedStyle(dialog).display, expanded:document.querySelector('.new-island')?.getAttribute('aria-expanded'), backdropTarget:document.elementFromPoint(5,5)?.className }; })()`).catch(() => null)
      failure = `${String(error)}; ${JSON.stringify(state)}`
    }
    finally {
      reports.push({ viewport, ok: failure === null, error: failure, steps, errors: [...cdp.errors] })
      media.push({ viewport, screenshot: capture })
      await writeFile(resolve(shots, 'restart-dialog.json'), `${JSON.stringify(reports, null, 2)}\n`)
      await writeFile(resolve(shots, 'restart-dialog-media.json'), `${JSON.stringify({ schemaVersion: 1, captures: media, rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
      await close()
    }
    if (failure) throw new Error(failure)
    console.log(`Restart dialog native keyboard, seed, checkpoint and viewport checks passed at ${viewport.width}x${viewport.height}, scale ${viewport.scale}.`)
  }
}
finally { await closeSharedBrowsers() }
