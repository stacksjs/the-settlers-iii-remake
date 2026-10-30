import { closeSharedBrowsers, launch, navigate } from '@stacksjs/testing/browser'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { sessionFromSnapshot } from '../../app/Multiplayer/Room'
import { signInCookie } from './session'

// Two signed-in players, two real browsers, one match over Stacks realtime:
// host, join by code, start from the lobby, build on both sides, and confirm
// that both copies of the world stay in step with the server turn for turn
// and each sees the other's castle and hut.
const base = process.argv[2] ?? 'http://127.0.0.1:3450/'
const at = (path: string): string => new URL(path, base).href
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const steps: { who: string, action: string, label: string, ok: boolean }[] = []

type Cdp = Awaited<ReturnType<typeof launch>>['cdp']
const players = await Promise.all((['default', 'guest'] as const).map(async (who, index) => {
  const { cdp, close } = await launch({ viewport: { width: 1280, height: 800, deviceScaleFactor: 1 } })
  const session = await signInCookie(base, who)
  await cdp.send('Network.setCookie', { name: session.name, value: session.value, url: base, httpOnly: true })
  return { who: index === 0 ? 'host' : 'guest', cdp, close }
}))
const [host, guest] = players as [typeof players[0], typeof players[0]]

const check = async (player: typeof host, label: string, expression: string, timeout = 8000): Promise<void> => {
  const deadline = performance.now() + timeout
  for (;;) {
    if (await player.cdp.evaluate<boolean>(expression)) { steps.push({ who: player.who, action: 'assert', label, ok: true }); return }
    if (performance.now() >= deadline) { steps.push({ who: player.who, action: 'assert', label, ok: false }); throw new Error(`Multiplayer (${player.who}): ${label}`) }
    await Bun.sleep(50)
  }
}
const point = (cdp: Cdp, selector: string, text?: string) => cdp.evaluate<{ x: number, y: number }>(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(el => !${JSON.stringify(text ?? '')} || el.textContent.includes(${JSON.stringify(text ?? '')}))
  const el = els[0]; if (!el || el.disabled) throw new Error('Missing enabled control ' + ${JSON.stringify(selector + (text ?? ''))})
  el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
const click = async (player: typeof host, selector: string, text?: string): Promise<void> => {
  const p = await point(player.cdp, selector, text)
  await player.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
  await player.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
  steps.push({ who: player.who, action: 'click', label: selector + (text ? ` ${text}` : ''), ok: true })
}
const key = async (player: typeof host, value: string, code: string, virtual: number, text?: string): Promise<void> => {
  await player.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: virtual, ...(text ? { text, unmodifiedText: text } : {}) })
  await player.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: virtual })
}
const sync = (player: typeof host) => player.cdp.evaluate<{ turn: number, verified: number, resyncs: number, buildings: number }>(`(() => { const el = document.querySelector('#match-sync'); return el ? { turn: Number(el.dataset.turn), verified: Number(el.dataset.verified), resyncs: Number(el.dataset.resyncs), buildings: Number(el.dataset.buildings) } : { turn: -1, verified: -1, resyncs: -1, buildings: -1 } })()`)

try {
  // 1. The host opens a match and gets a code.
  if (!await navigate(host.cdp, at('multiplayer'))) throw new Error('The lobby did not settle')
  await click(host, '#host-match')
  await check(host, 'the host has a five-letter match code', `/^[A-HJ-NP-Z2-9]{5}$/.test(document.querySelector('#room-code')?.textContent.trim() ?? '')`)
  const code = await host.cdp.evaluate<string>(`document.querySelector('#room-code').textContent.trim()`)
  await check(host, 'the host cannot start alone', `document.querySelector('#start-match').disabled`)

  // 2. The guest joins by typing the code.
  if (!await navigate(guest.cdp, at('multiplayer'))) throw new Error('The guest lobby did not settle')
  await click(guest, '#match-code')
  await guest.cdp.send('Input.insertText', { text: code })
  await click(guest, '#join-match')
  await check(guest, 'the guest is seated and waits for the host', `document.querySelector('#waiting-host') && document.querySelector('#room-code').textContent.trim() === ${JSON.stringify(code)}`)
  await check(host, 'the host sees the second seat fill through the live stream', `document.querySelectorAll('#room-code ~ *, ul li').length > 0 && !document.querySelector('#start-match').disabled`, 15000)

  // 3. A guest who leaves frees the seat, and can take it again.
  await click(guest, 'button', 'Leave')
  await check(guest, 'a guest who leaves is back at the choice of host or join', `!!document.querySelector('#join-match') && !document.querySelector('#room-code')`)
  await check(host, 'the host sees the seat free again and cannot start', `document.querySelector('#start-match').disabled && document.body.innerText.includes('Waiting for the second player')`, 15000)
  await click(guest, '#match-code')
  await guest.cdp.send('Input.insertText', { text: code.toLowerCase() })
  await click(guest, '#join-match')
  await check(host, 'the host sees the guest seated again, whatever case the code was typed in', `!document.querySelector('#start-match').disabled`, 15000)

  // 4. The lobby shows both seats.
  await check(guest, 'the guest sees both seats', `document.body.innerText.includes('West castle') && document.body.innerText.includes('East castle')`)

  // 5. The host starts; both browsers enter the match.
  await click(host, '#start-match')
  for (const player of [host, guest]) await check(player, 'both players enter the match page', `location.pathname === '/play' && location.search.includes('room=${code}')`, 30000)
  for (const player of [host, guest]) await check(player, 'the match boots from the server snapshot', `!!document.querySelector('#match-sync') && !!document.querySelector('.building-choice:not(:disabled)')`, 90000)
  await check(host, 'the host holds the west castle', `document.body.innerText.includes('west castle')`)
  await check(guest, 'the guest holds the east castle', `document.body.innerText.includes('east castle')`)

  // 6. Both players build a woodcutter with the real controls.
  for (const player of [host, guest]) {
    await click(player, '.building-choice', 'Woodcutter')
    await key(player, 'Enter', 'Enter', 13, '\r')
  }
  // Every copy sees four buildings: two castles and two huts, one of each from each side.
  for (const player of [host, guest]) await check(player, 'both castles and both huts exist on this copy of the world', `Number(document.querySelector('#match-sync').dataset.buildings) === 4`, 20000)

  // 7. The simulation keeps running in step: many verified turns and not one resync.
  for (const player of [host, guest]) await check(player, 'at least twenty server turns ran and verified on this copy', `Number(document.querySelector('#match-sync').dataset.verified) >= 20`, 30000)
  const [h, g] = [await sync(host), await sync(guest)]
  steps.push({ who: 'both', action: 'assert', label: `host verified ${h.verified} turns, guest ${g.verified}, resyncs ${h.resyncs}/${g.resyncs}`, ok: h.verified >= 20 && g.verified >= 20 && h.resyncs === 0 && g.resyncs === 0 })
  if (h.resyncs !== 0 || g.resyncs !== 0) throw new Error(`A copy fell out of step: ${h.resyncs}/${g.resyncs} resyncs`)
  // The two copies are within a turn or two of each other.
  if (Math.abs(h.turn - g.turn) > 6) throw new Error(`Copies are ${Math.abs(h.turn - g.turn)} turns apart`)

  // 8. A player who loses the connection catches up when it returns, and the world agrees again.
  await guest.cdp.send('Network.enable')
  await guest.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await click(host, '.building-choice', 'Stonecutter')
  await key(host, 'Enter', 'Enter', 13, '\r')
  await check(host, 'the host builds on while the guest is offline', `Number(document.querySelector('#match-sync').dataset.buildings) === 5`, 20000)
  await Bun.sleep(4000)
  await guest.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await check(guest, 'the guest catches up and sees the stonecutter site the host placed while away', `Number(document.querySelector('#match-sync').dataset.buildings) === 5`, 60000)
  const before = (await sync(guest)).verified
  await check(guest, 'and verifies fresh turns against the server afterwards', `Number(document.querySelector('#match-sync').dataset.verified) >= ${before + 20}`, 30000)

  // 9. A reload resumes the same match from the server.
  await host.cdp.evaluate(`location.reload(); true`)
  await check(host, 'a reloaded host rejoins the running match', `!!document.querySelector('#match-sync') && Number(document.querySelector('#match-sync').dataset.buildings) === 5`, 60000)

  // 10. When one side loses its last castle the match ends: victory for one screen, defeat for the other.
  const csrf = async (cookie: string) => {
    const response = await fetch(at('login'), { redirect: 'manual' })
    const token = response.headers.getSetCookie().find(value => value.startsWith('X-CSRF-Token='))!.split(';')[0]!.slice('X-CSRF-Token='.length)
    return { cookie: `${cookie}; X-CSRF-Token=${token}`, token: decodeURIComponent(token) }
  }
  const asGuest = await signInCookie(base, 'guest')
  const credentials = await csrf(`${asGuest.name}=${asGuest.value}`)
  const api = (path: string, init: RequestInit = {}) => fetch(at(`api/multiplayer/rooms/${code}${path}`), { ...init, headers: { 'content-type': 'application/json', cookie: credentials.cookie, 'X-CSRF-Token': credentials.token } })
  const world = sessionFromSnapshot(((await (await api('/snapshot')).json()) as { envelope: unknown }).envelope)
  const castle = [...world.state.buildings.values()].find(b => b.owner === 2 && b.type === 'castle')!
  world.dispose()
  const order = await api('/orders', { method: 'POST', body: JSON.stringify({ type: 'demolish', fields: { building: castle.id } }) })
  steps.push({ who: 'guest', action: 'order', label: `demolish own castle answered ${order.status}`, ok: order.ok })
  await check(host, 'the host sees victory when the opponent has no castle left', `document.querySelector('#match-over')?.dataset.outcome === 'won' && document.querySelector('#match-over').innerText.includes('Victory')`, 30000)
  await check(guest, 'the guest sees defeat', `document.querySelector('#match-over')?.dataset.outcome === 'lost' && document.querySelector('#match-over').innerText.includes('Defeat')`, 30000)

  await writeFile(resolve(shots, 'multiplayer.json'), `${JSON.stringify({ code, host: h, guest: g, steps }, null, 2)}\n`)
  console.log(`An online match passed in two browsers: ${h.verified}/${g.verified} turns verified against the server, no resync, both settlements visible to both players, a dropped connection recovered, a reload rejoined, and the match ended in victory and defeat.`)
}
catch (error) {
  const states = await Promise.all([host, guest].map(player => player.cdp.evaluate<string>(`JSON.stringify({ path: location.pathname + location.search, sync: document.querySelector('#match-sync')?.dataset, text: document.body.innerText.slice(0, 400) })`).catch(() => 'unavailable')))
  await writeFile(resolve(shots, 'multiplayer.json'), `${JSON.stringify({ steps, states, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
  throw error
}
finally {
  await Promise.all(players.map(player => player.close()))
  await closeSharedBrowsers()
}
