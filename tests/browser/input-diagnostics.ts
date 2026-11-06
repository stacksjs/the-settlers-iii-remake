import type { Cdp } from '@stacksjs/testing/browser'
import { launch, navigate, waitFor } from '@stacksjs/testing/browser'

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
  // Each comparison uses a fresh Chrome process and native button. No touch
  // listeners are registered. These observations do not replace game acceptance.
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button id="native-touch-control" style="position:fixed;left:40px;top:380px;width:220px;height:80px">Native touch control</button><script>globalThis.nativeInputEvents=[];document.addEventListener('click',event=>nativeInputEvents.push({type:event.type,trusted:event.isTrusted,prevented:event.defaultPrevented,target:event.target.id}),{capture:true,passive:true})<\/script>`
  const variants = [
    { method: 'raw-id1-default', id: 1 },
    { method: 'raw-id0-default', id: 0 },
    { method: 'raw-id1-explicit', id: 1, radius: 1 },
    { method: 'raw-id0-explicit', id: 0, radius: 1 },
    { method: 'raw-id0-half-radius', id: 0, radius: 0.5 },
    { method: 'gesture', gesture: true },
  ]
  const cases: { method: string, events: unknown[], focused: boolean, scale: number, target: string | null }[] = []
  for (const variant of variants) {
    const control = await launch({ shared: false, viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } })
    try {
      await control.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
      if (!await navigate(control.cdp, `data:text/html,${encodeURIComponent(html)}`)) throw new Error('Native input calibration did not settle')
      const state = await control.cdp.evaluate<{ focused: boolean, scale: number, target: string | null }>(`({ focused: document.hasFocus(), scale: visualViewport?.scale, target: document.elementFromPoint(150, 420)?.id })`)
      if (state.target !== 'native-touch-control' || state.scale !== 1) throw new Error('Native input control geometry differs from the intended viewport')
      if (variant.gesture) await control.cdp.send('Input.synthesizeTapGesture', { x: 150, y: 420, duration: 50, gestureSourceType: 'touch' })
      else {
        const point = { x: 150, y: 420, id: variant.id, ...(variant.radius === undefined ? {} : { radiusX: variant.radius, radiusY: variant.radius, force: 1 }) }
        await control.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await control.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      await waitFor(() => control.cdp.evaluate<boolean>(`nativeInputEvents.some(event => event.type === 'click')`), 1500).catch(() => false)
      cases.push({ method: variant.method, ...state, events: await control.cdp.evaluate<unknown[]>('nativeInputEvents') })
    }
    finally { await control.close() }
  }
  return { page, listeners, cases }
}
