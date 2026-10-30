import { useBroadcastStream } from '@stacksjs/stx/composables'
import type { MatchLink, MatchTurn } from './controller'

/**
 * The browser's side of an online match, over Stacks realtime: orders go to the
 * match's HTTP routes, and the server's turns arrive on its authenticated
 * broadcast stream. The controller sees only the `MatchLink` it is given.
 */
const BASE = '/api/multiplayer/rooms'

interface Snapshot { turn: number, tick: number, seed: number, envelope: unknown, you: number }
export interface RoomInfo {
  code: string
  status: 'lobby' | 'running' | 'over'
  seed: number
  turn: number
  seats: { name: string, player: number, host: boolean }[]
  outcome: Record<string, 'playing' | 'won' | 'lost'>
  you: number
}

const cookie = (name: string): string | null => {
  const hit = document.cookie.split('; ').find(part => part.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
}

/** Every state-changing request carries the CSRF token the server issued; a first visit fetches one. */
async function csrf(): Promise<string> {
  let token = cookie('X-CSRF-Token')
  if (!token) {
    await fetch('/login', { credentials: 'same-origin' })
    token = cookie('X-CSRF-Token')
  }
  if (!token) throw new Error('The server did not issue a session token. Reload and try again.')
  return token
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = await csrf() }
  const response = await fetch(`${BASE}${path}`, { method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in to play online.')
    throw new Error((data as { message?: string } | null)?.message ?? `The server answered ${response.status}.`)
  }
  return data as T
}

export const createMatch = (): Promise<RoomInfo> => call('POST', '')
export const joinMatch = (code: string): Promise<RoomInfo> => call('POST', `/${encodeURIComponent(code)}/join`)
export const startMatch = (code: string): Promise<RoomInfo> => call('POST', `/${encodeURIComponent(code)}/start`)
export const showMatch = (code: string): Promise<RoomInfo> => call('GET', `/${encodeURIComponent(code)}`)

/**
 * The lobby as a live view: every change to who is seated, and the host's start,
 * arrive on the room's stream. Returns a function that stops listening.
 */
export function watchLobby(code: string, onRoom: (room: RoomInfo | null) => void, onStart: () => void): () => void {
  const stream = useBroadcastStream({
    request: (path, init) => fetch(path, { ...init, credentials: 'same-origin' }),
    endpoint: `${BASE}/${encodeURIComponent(code)}/stream`,
    onMessage: frame => {
      if (frame.event === 'lobby') onRoom(frame.data as RoomInfo)
      if (frame.event === 'start') onStart()
    },
    // A reconnect may have missed the start, so the lobby is read again.
    onConnected: () => { void showMatch(code).then(room => { onRoom(room); if (room.status === 'running') onStart() }).catch(() => onRoom(null)) },
  })
  return () => stream.close()
}

/** The link the controller plays one match through. */
export function matchLink(code: string, player: number): MatchLink {
  const id = encodeURIComponent(code)
  let stream: { close: () => void } | null = null
  const snapshot = (): Promise<Snapshot> => call('GET', `/${id}/snapshot`)
  return {
    player,
    async open(onTurn, onStatus, onNotice) {
      const buffered: MatchTurn[] = []
      let deliver: ((turn: MatchTurn) => void) | null = null
      let connect: () => void = () => {}
      const connected = new Promise<void>(resolve => { connect = resolve })
      let first = true
      stream = useBroadcastStream({
        request: (path, init) => fetch(path, { ...init, credentials: 'same-origin' }),
        endpoint: `${BASE}/${id}/stream`,
        onMessage: frame => {
          if (frame.event === 'turn') { if (deliver) deliver(frame.data as MatchTurn); else buffered.push(frame.data as MatchTurn) }
          else if (frame.event === 'error') onNotice(String((frame.data as { message?: string }).message ?? 'The match stopped.'))
          else if (frame.event === 'over') onNotice('The match is over.')
        },
        onConnected: () => { connect(); if (!first) onStatus(true); first = false },
        onStatus: up => { if (!up && !first) onStatus(false) },
      })
      // Listening first and reading the world second means no turn can fall between the two.
      await Promise.race([connected, new Promise<void>(resolve => setTimeout(resolve, 8000))])
      const world = await snapshot()
      deliver = onTurn
      for (const turn of buffered.splice(0)) if (turn.n > world.turn) onTurn(turn)
      return { envelope: world.envelope, turn: world.turn }
    },
    async resync() {
      const world = await snapshot()
      return { envelope: world.envelope, turn: world.turn }
    },
    async order(type, fields) { await call('POST', `/${id}/orders`, { type, fields }) },
    close() { stream?.close(); stream = null },
  }
}

/** Copies text for the player. Returns whether the browser allowed it. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true }
  catch { return false }
}

/** The invite link a host shares: the lobby page with the code ready to join. */
export const inviteLink = (code: string): string => `${location.origin}/multiplayer?join=${encodeURIComponent(code)}`

/** Leaves the lobby for the match. A full page load, because the game owns the whole page. */
export function enterMatch(code: string): void { location.assign(`/play?room=${encodeURIComponent(code)}`) }
