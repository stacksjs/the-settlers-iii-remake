import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'
import { referenceFrames, referenceImage, referenceCompose } from '../fixtures/reference-dat'

const root = resolve(import.meta.dir, '../..'), shots = resolve(root, 'storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'player-colors-')), capture = resolve(directory, 'player-colors.png')
const bytes = Buffer.from(await Bun.file(resolve(root, 'storage/reference/demo/Gfx/Siedler3_11.f8007e01f.dat')).arrayBuffer())
const body = referenceImage(bytes, referenceFrames(bytes, 0x106, 37)[0]!), gray = referenceImage(bytes, referenceFrames(bytes, 0x3112, 37)[0]!, true)
const variants = [
  { slots: [0, 1], colors: [[247, 16, 0], [16, 140, 247]] },
  { slots: [7, 19], colors: [[41, 41, 41], [140, 189, 239]] },
  { slots: [31, 0], colors: [[255, 87, 143], [247, 16, 0]] },
].map(variant => {
  const samples: { owner: number, x: number, y: number, rgb: number[] }[] = []
  for (const [index, rgb] of variant.colors.entries()) {
    const torso = { ...gray, data: Buffer.from(gray.data) }
    for (let p = 0; p < torso.data.length; p += 4) for (let c = 0; c < 3; c++) torso.data[p + c] = Math.round(gray.data[p + 2]! * rgb[c]! / 255)
    const composed = referenceCompose([torso, body])
    for (let y = 0; y < composed.height; y++) for (let x = 0; x < composed.width; x++) {
      const p = (y * composed.width + x) * 4
      if (composed.data[p + 3]) samples.push({ owner: index + 1, x: x + composed.offsetX, y: y + composed.offsetY, rgb: [...composed.data.subarray(p, p + 3)] })
    }
  }
  return { slots: variant.slots, samples }
})
const bundle = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/player-color-browser.ts')], target: 'browser' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Player-color fixture build failed')
const js = await bundle.outputs[0]!.text(), assetRoot = resolve(root, 'public/assets/settlers-original')
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } })
  if (path === '/expected.json') return Response.json(variants)
  if (path.startsWith('/assets/settlers-original/')) {
    const file = resolve(assetRoot, decodeURIComponent(path.slice('/assets/settlers-original/'.length)))
    if (file.startsWith(assetRoot + sep)) return new Response(Bun.file(file))
    return new Response('Invalid asset path', { status: 400 })
  }
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
  await writeFile(resolve(shots, 'player-colors.json'), out)
  if (err) console.error(err)
  if (code !== 0) throw new Error('Player-color browser fixture failed; see retained report')
  const image = await readFile(capture)
  await writeFile(resolve(shots, 'player-colors-media.json'), `${JSON.stringify({ schemaVersion: 1, screenshot: { sha256: Bun.SHA256.hash(image, 'hex'), bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) }, scope: 'Authored production-renderer pixel fixture, not human gameplay or original Gold observations.', rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
  console.log(`Player-color browser pixel checks passed (${variants.reduce((sum, variant) => sum + variant.samples.length, 0)} independent source pixels).`)
}
finally { server.stop(true) }
