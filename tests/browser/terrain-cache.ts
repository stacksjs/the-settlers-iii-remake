import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dir, '../..'), shots = resolve(root, 'storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'terrain-cache-')), capture = resolve(directory, 'terrain-cache.png')
const bundle = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/terrain-cache-browser.ts')], target: 'browser' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Terrain-cache fixture build failed')
const js = await bundle.outputs[0]!.text()
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } })
  return new Response('<!doctype html><canvas width="800" height="480" style="width:800px;height:480px"></canvas><pre id="result">Preparing</pre><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } })
} })
try {
  const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', root)), driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
  const steps = [
    { action: 'assert', selector: '#result', text: '"ok":true', timeoutMs: 30000 },
    { action: 'evaluate', expression: 'JSON.parse(document.querySelector("#result").textContent)' },
  ]
  const child = Bun.spawn([process.execPath, driver, 'scenario', `http://127.0.0.1:${server.port}/`, '--viewport', '900x600', '--out', capture, ...steps.flatMap(step => ['--step', JSON.stringify(step)])], { stdout: 'pipe', stderr: 'pipe', timeout: 60000 })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  await writeFile(resolve(shots, 'terrain-cache.json'), out)
  if (err) console.error(err)
  if (code !== 0) throw new Error('Terrain-cache browser fixture failed; see retained report')
  const image = await readFile(capture)
  await writeFile(resolve(shots, 'terrain-cache-media.json'), `${JSON.stringify({ schemaVersion: 1, screenshot: { sha256: Bun.SHA256.hash(image, 'hex'), bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) }, scope: 'Actual terrain cache and authored public-session rendering. Capacity is not process RSS or GPU memory.', rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
  console.log('Terrain cache budget, pan/return pixels, viewport, invalidation and disposal checks passed.')
}
finally { server.stop(true) }
