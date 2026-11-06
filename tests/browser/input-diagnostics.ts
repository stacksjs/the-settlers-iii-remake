import type { Cdp } from '@stacksjs/testing/browser'
import { navigate, waitFor } from '@stacksjs/testing/browser'

/** Failure-only calibration. It never replaces the failed game assertion. */
export async function touchFailureDiagnostics(cdp: Cdp) {
  const page = await cdp.evaluate(`({ focused: document.hasFocus(), visibility: document.visibilityState, active: document.activeElement?.tagName, scale: visualViewport?.scale, scrollY })`)
  const listeners: { target: string, listeners: unknown[] }[] = []
  for (const target of ['window', 'document', "document.querySelector('[role=toolbar] button')", "document.querySelector('#demo-map')"]) {
    const remote = await cdp.send('Runtime.evaluate', { expression: target })
    if (!remote.result?.objectId) continue
    try {
      const value = await cdp.send('DOMDebugger.getEventListeners', { objectId: remote.result.objectId })
      listeners.push({ target, listeners: value.listeners.filter((entry: { type: string }) => /touch|pointer|click/.test(entry.type)).map((entry: { type: string, useCapture: boolean, passive: boolean, scriptId: string, lineNumber: number, handler?: { description?: string } }) => ({ type: entry.type, capture: entry.useCapture, passive: entry.passive, scriptId: entry.scriptId, line: entry.lineNumber, handler: entry.handler?.description?.slice(0, 180) })) })
    }
    finally { await cdp.send('Runtime.releaseObject', { objectId: remote.result.objectId }) }
  }
  // Compare observed input on an inert page. These sequential observations
  // do not establish why the game did not receive a click. This page has no game, assets, credentials or simulated world.
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button id="native-touch-control" style="position:fixed;left:40px;top:380px;width:220px;height:80px">Native touch control</button><script>globalThis.nativeInputEvents=[];for(const type of ['pointerdown','pointerup','touchstart','touchend','click'])document.addEventListener(type,event=>setTimeout(()=>nativeInputEvents.push({type,trusted:event.isTrusted,prevented:event.defaultPrevented}),0),{capture:true,passive:true})<\/script>`
  if (!await navigate(cdp, `data:text/html,${encodeURIComponent(html)}`)) throw new Error('Native input calibration did not settle')
  const cases: { method: string, events: unknown[], focused: boolean }[] = []
  for (const method of ['gesture', 'touch-points', 'foreground-gesture']) {
    await cdp.evaluate('nativeInputEvents.length = 0')
    if (method === 'foreground-gesture') await cdp.send('Page.bringToFront')
    if (method === 'touch-points') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 420, id: 0, radiusX: 1, radiusY: 1, force: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    else await cdp.send('Input.synthesizeTapGesture', { x: 150, y: 420, duration: 50, gestureSourceType: 'touch' })
    await waitFor(() => cdp.evaluate<boolean>(`nativeInputEvents.some(event => event.type === 'click')`), 1500).catch(() => false)
    cases.push({ method, ...await cdp.evaluate<{ events: unknown[], focused: boolean }>('({ events: nativeInputEvents, focused: document.hasFocus() })') })
  }
  return { page, listeners, cases }
}
