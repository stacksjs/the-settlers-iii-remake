import { expect, test } from 'bun:test'
import { verifyDeployment } from '../../scripts/deploy-smoke'

const home = '<title>The Settlers III Remake</title><canvas id="demo-map"></canvas><footer>Blue Byte and Ubisoft <a href="/credits">Credits</a></footer>'
// A one-pixel red VP8L image, independently decoded by macOS ImageIO as 1x1.
const image = Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+hysi+h8A', 'base64')

function response(path: string): Response {
  if (path === '/play') return new Response(null, { status: 302, headers: { location: '/login?next=%2Fplay' } })
  if (path.startsWith('/showcase/')) return new Response(image, { headers: { 'content-type': 'image/webp' } })
  return new Response(path === '/' ? home : '<title>The Settlers III Remake</title>', { headers: { 'content-type': 'text/html' } })
}

async function check(overrides: Record<string, () => Response> = {}): Promise<Awaited<ReturnType<typeof verifyDeployment>>> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    const path = new URL(request.url).pathname
    return overrides[path]?.() ?? response(path)
  } })
  try { return await verifyDeployment(server.url.href) }
  finally { server.stop(true) }
}

test('deployment smoke checks public pages, showcase images and the signed-out game gate over real HTTP', async () => {
  expect((await check()).map(result => result.path)).toEqual(['/', '/login', '/register', '/credits', '/terms', '/privacy', '/blog', '/showcase/tutorial.webp', '/showcase/rival.webp', '/play'])
})

test('an unrelated page returning 200 does not qualify the deployment', async () => {
  await expect(check({ '/': () => new Response('<title>Welcome</title>', { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow('Home page identity')
})

test('missing public routes and malformed showcase images fail deployment smoke', async () => {
  await expect(check({ '/credits': () => new Response('Not found', { status: 404 }) })).rejects.toThrow('/credits returned 404')
  await expect(check({ '/showcase/tutorial.webp': () => new Response('Not an image', { headers: { 'content-type': 'image/webp' } }) })).rejects.toThrow('/showcase/tutorial.webp is not a decodable WebP image')
  await expect(check({ '/showcase/tutorial.webp': () => new Response(image.subarray(0, 12), { headers: { 'content-type': 'image/webp' } }) })).rejects.toThrow('/showcase/tutorial.webp is not a decodable WebP image')
})

test('a public game or a redirect outside the expected sign-in gate fails deployment smoke', async () => {
  await expect(check({ '/play': () => new Response('Game') })).rejects.toThrow('Signed-out /play')
  await expect(check({ '/play': () => new Response(null, { status: 302, headers: { location: 'https://example.test/login?next=/play' } }) })).rejects.toThrow('Signed-out /play')
  await expect(check({ '/play': () => new Response(null, { status: 302, headers: { location: '/login' } }) })).rejects.toThrow('Signed-out /play')
})

test('public deployment smoke requires a clean HTTPS origin', async () => {
  for (const base of ['http://example.test', 'https://user:secret@example.test', 'https://example.test/play']) {
    await expect(verifyDeployment(base)).rejects.toThrow('Deployment URL')
  }
})
