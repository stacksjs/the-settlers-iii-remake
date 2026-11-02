import process from 'node:process'
import { decode } from '@stacksjs/ts-webp'

/** Read-only acceptance for this application's public front door after cutover. */
export async function verifyDeployment(base: string): Promise<{ path: string, status: number }[]> {
  const origin = new URL(base)
  const local = origin.hostname === '127.0.0.1' || origin.hostname === '[::1]'
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('Deployment URL must be a clean HTTPS origin (HTTP loopback is allowed for local acceptance)')

  const results: { path: string, status: number }[] = []
  for (const path of ['/', '/login', '/register', '/credits', '/terms', '/privacy', '/blog', '/showcase/tutorial.webp', '/showcase/rival.webp', '/play']) {
    const result = await fetch(new URL(path, origin), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000) })
    results.push({ path, status: result.status })
    if (path === '/play') {
      const location = result.headers.get('location')
      const login = location ? new URL(location, origin) : null
      await result.body?.cancel()
      if (result.status !== 302 || login?.origin !== origin.origin || login.pathname !== '/login' || login.searchParams.get('next') !== '/play')
        throw new Error('Signed-out /play must redirect to this deployment\'s sign-in page and retain /play as the next destination')
      continue
    }
    if (result.status !== 200) {
      await result.body?.cancel()
      throw new Error(`${path} returned ${result.status}`)
    }
    if (path.startsWith('/showcase/')) {
      const bytes = new Uint8Array(await result.arrayBuffer())
      if (!result.headers.get('content-type')?.startsWith('image/webp'))
        throw new Error(`${path} is not a WebP image`)
      try { decode(bytes) }
      catch { throw new Error(`${path} is not a decodable WebP image`) }
      continue
    }
    const html = await result.text()
    if (!result.headers.get('content-type')?.startsWith('text/html')) throw new Error(`${path} is not an HTML page`)
    if (path === '/' && (!html.includes('<title>The Settlers III Remake</title>') || !html.includes('id="demo-map"') || !html.includes('Blue Byte') || !html.includes('Ubisoft') || !html.includes('/credits')))
      throw new Error('Home page identity, guest demo or original-game credit is missing')
  }
  return results
}

if (import.meta.main) {
  if (!process.argv[2]) throw new Error('Provide the public deployment origin: bun scripts/deploy-smoke.ts https://example.test')
  console.log(JSON.stringify({ checks: await verifyDeployment(process.argv[2]) }, null, 2))
}
