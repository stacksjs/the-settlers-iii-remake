/**
 * A real signed-in session for the production browser checks.
 *
 * Playing is behind the Stacks page gate, so the checks sign in the same way a
 * visitor does: the CSRF cookie the server hands out, then the maintained
 * register or login endpoint. The cookie that endpoint sets is what the gate
 * validates. Nothing here bypasses or forges a session.
 */
const accounts = {
  default: { name: 'Browser Acceptance', email: 'browser-acceptance@example.test', password: 'Acceptance-Check-9!' },
  // A second player, for the checks that need two people in one match.
  guest: { name: 'Browser Guest', email: 'browser-guest@example.test', password: 'Guest-Acceptance-7!' },
} as const
export type Who = keyof typeof accounts

/** The page the checks drive, resolved from the server's base address. */
export function playUrl(base: string): string {
  return new URL('play', base).href
}

async function csrf(origin: string): Promise<{ cookie: string, token: string }> {
  const response = await fetch(new URL('login', origin), { redirect: 'manual' })
  const set = response.headers.getSetCookie().find(value => value.startsWith('X-CSRF-Token='))
  const token = set?.split(';')[0]?.slice('X-CSRF-Token='.length)
  if (!token) throw new Error('The server did not issue a CSRF token')
  return { cookie: `X-CSRF-Token=${token}`, token }
}

async function post(origin: string, path: string, body: unknown): Promise<Response> {
  const { cookie, token } = await csrf(origin)
  return fetch(new URL(path, origin), {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', 'cookie': cookie, 'X-CSRF-Token': decodeURIComponent(token) },
    body: JSON.stringify(body),
  })
}

const sessions = new Map<string, Promise<{ name: string, value: string }>>()

/** Sends the request again after the server's rate limit window, which sign-in endpoints enforce per minute. */
async function postPatient(origin: string, path: string, body: unknown): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await post(origin, path, body)
    if (response.status !== 429) return response
    await Bun.sleep((Number(response.headers.get('retry-after')) || 15) * 1000)
  }
  return post(origin, path, body)
}

async function authenticate(origin: string, who: Who): Promise<{ name: string, value: string }> {
  const account = accounts[who]
  // Sign in first: it is the common case once the account exists, and registration is limited more tightly.
  let response = await postPatient(origin, 'login', { email: account.email, password: account.password })
  if (!response.ok) response = await postPatient(origin, 'register', { ...account, password_confirmation: account.password, terms: true })
  if (!response.ok) throw new Error(`Sign-in for the browser checks failed with ${response.status}`)
  const set = response.headers.getSetCookie().find(value => !value.startsWith('X-CSRF-Token=') && /^[^=]+=[^;]+/.test(value))
  const pair = set?.split(';')[0]
  if (!pair) throw new Error('Sign-in did not set an auth cookie')
  const separator = pair.indexOf('=')
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
}

/** The auth cookie as `name`/`value`, signed in once per process and server. */
export function signInCookie(base: string, who: Who = 'default'): Promise<{ name: string, value: string }> {
  const key = `${new URL(base).origin} ${who}`
  if (!sessions.has(key)) sessions.set(key, authenticate(new URL(base).origin, who))
  return sessions.get(key)!
}

/** Driver arguments that pre-seed the signed-in cookie. */
export async function signInArgs(base: string, who: Who = 'default'): Promise<string[]> {
  const { name, value } = await signInCookie(base, who)
  return ['--cookie', `${name}=${value}`]
}
