import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'
import { referenceFrames, referenceImage } from '../fixtures/reference-dat'

const root = resolve(import.meta.dir, '../..'), shots = resolve(root, 'storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'shadows-')), capture = resolve(directory, 'shadows.png'), source = resolve(root, 'storage/reference/demo/Gfx'), names = await readdir(source)
const poses: { sprite: string, frame: number, samples: { x: number, y: number, alpha: number, groundX: number }[] }[] = []
for (const [sprite, file, sequence] of [['worker', 10, 0], ['soldier:swordsman-1', 12, 9], ['geologist', 11, 37], ['geologist-survey-1', 11, 39], ['geologist-survey-2', 11, 38]] as const) {
  const name = names.find(name => name.toLowerCase() === `siedler3_${String(file).padStart(2, '0')}.f8007e01f.dat`)
  if (!name) throw new Error(`Original DAT ${file} is missing`)
  const bytes = Buffer.from(await Bun.file(resolve(source, name)).arrayBuffer()), bodies = referenceFrames(bytes, 0x106, sequence), torsos = referenceFrames(bytes, 0x3112, sequence), shadows = referenceFrames(bytes, 0x5982, sequence)
  for (const [frame, offset] of shadows.entries()) {
    const body = referenceImage(bytes, bodies[frame]!), torso = torsos[frame] === undefined ? null : referenceImage(bytes, torsos[frame]!, true), shadow = referenceImage(bytes, offset, 'shadow')
    const opaque = (image: typeof body | null, x: number, y: number): boolean => !!image && x >= image.offsetX && y >= image.offsetY && x < image.offsetX + image.width && y < image.offsetY + image.height && !!image.data[((y - image.offsetY) * image.width + x - image.offsetX) * 4 + 3]
    const samples: typeof poses[number]['samples'] = []
    for (let y = shadow.offsetY - 2; y < shadow.offsetY + shadow.height + 2; y++) for (let x = shadow.offsetX - 2; x < shadow.offsetX + shadow.width + 2; x++) {
      if (opaque(body, x, y) || opaque(torso, x, y)) continue
      const alpha = x >= shadow.offsetX && y >= shadow.offsetY && x < shadow.offsetX + shadow.width && y < shadow.offsetY + shadow.height ? shadow.data[((y - shadow.offsetY) * shadow.width + x - shadow.offsetX) * 4 + 3]! : 0
      // The terrain mesh has antialiased shared edges. Measure the same
      // periodic flat-ground location beyond every source layer, rather than
      // assuming its rasterized background is one constant color.
      const groundX = [48, -48, 32, -32].map(shift => x + shift).find(ref => Math.abs(ref) <= 48 && !opaque(body, ref, y) && !opaque(torso, ref, y) && !opaque(shadow, ref, y))
      if (groundX === undefined) throw new Error(`No isolated periodic ground sample for ${sprite}:${frame}`)
      samples.push({ x, y, alpha, groundX })
    }
    poses.push({ sprite, frame, samples })
  }
}
const bundle = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/shadow-browser.ts')], target: 'browser' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Shadow fixture build failed')
const javascript = await bundle.outputs[0]!.text(), assetRoot = resolve(root, 'public/assets/settlers-original')
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(javascript, { headers: { 'Content-Type': 'text/javascript' } })
  if (path === '/expected.json') return Response.json(poses)
  if (path.startsWith('/assets/settlers-original/')) {
    const file = resolve(assetRoot, decodeURIComponent(path.slice('/assets/settlers-original/'.length)))
    return file.startsWith(assetRoot + sep) ? new Response(Bun.file(file)) : new Response('Invalid asset path', { status: 400 })
  }
  return new Response('<!doctype html><canvas width="800" height="480" style="width:800px;height:480px"></canvas><pre id="result">Preparing</pre><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } })
} })
try {
  const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', root)), driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
  const steps = [{ action: 'assert', selector: '#result', text: '"ok":true', timeoutMs: 30000 }, { action: 'evaluate', expression: 'JSON.parse(document.querySelector("#result").textContent)' }]
  const child = Bun.spawn([process.execPath, driver, 'scenario', `http://127.0.0.1:${server.port}/`, '--viewport', '900x600', '--out', capture, ...steps.flatMap(step => ['--step', JSON.stringify(step)])], { stdout: 'pipe', stderr: 'pipe', timeout: 60000 })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  await writeFile(resolve(shots, 'shadows.json'), out)
  if (err) console.error(err)
  if (code !== 0) throw new Error('Original shadow browser checks failed; see retained report')
  const image = await readFile(capture)
  await writeFile(resolve(shots, 'shadows-media.json'), `${JSON.stringify({ schemaVersion: 1, screenshot: { sha256: Bun.SHA256.hash(image, 'hex'), bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) }, scope: 'Production renderer, authored public sessions, flat ground for independent original-mask pixel checks. Not human gameplay or Gold observations.', rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
  console.log('Original shadow browser pixel, layer, depth, fog and persistence checks passed.')
}
finally { server.stop(true) }
