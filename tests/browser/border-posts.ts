import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'
import { referenceCompose, referenceFrames, referenceImage } from '../fixtures/reference-dat'
import { PLAYER_PALETTE } from '../../resources/game/player-colors'

const root = resolve(import.meta.dir, '../..'), shots = resolve(root, 'storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'border-posts-'))
const bytes = Buffer.from(await Bun.file(resolve(root, 'storage/reference/demo/Gfx/Siedler3_13.f8007e01f.dat')).arrayBuffer())
const body = referenceImage(bytes, referenceFrames(bytes, 0x106, 65)[0]!), gray = referenceImage(bytes, referenceFrames(bytes, 0x3112, 65)[0]!, true)
const variants = PLAYER_PALETTE.map((_, slot) => {
  const slots = [slot, (slot + 1) % 32]
  const posts = slots.map((slot, index) => {
    const torso = { ...gray, data: Buffer.from(gray.data) }, rgb = PLAYER_PALETTE[slot]!
    for (let p = 0; p < torso.data.length; p += 4) for (let c = 0; c < 3; c++) torso.data[p + c] = Math.round(gray.data[p + 2]! * rgb[c]! / 255)
    const combined = referenceCompose([torso, body]), samples = []
    for (let y = 0; y < combined.height; y++) for (let x = 0; x < combined.width; x++) {
      const p = (y * combined.width + x) * 4
      if (combined.data[p + 3]) samples.push({ x: x + combined.offsetX, y: y + combined.offsetY, rgb: [...combined.data.subarray(p, p + 3)] })
    }
    return { x: index ? 20 : 16, y: 16, samples }
  })
  return { slots, posts }
})
// Independent tree pixels that occupy the same projected pixels as the post.
const objects = Buffer.from(await Bun.file(resolve(root, 'storage/reference/demo/Gfx/Siedler3_01.f8007e01f.dat')).arrayBuffer())
const variety = (((16 * 73856093) ^ (16 * 19349663)) >>> 0) % 7, sequence = [1, 2, 4, 7, 8, 16, 17][variety]!
const tree = referenceImage(objects, referenceFrames(objects, 0x106, sequence)[0]!), occlusion: { x: number, y: number, rgb: number[] }[] = []
for (const sample of variants[0]!.posts[0]!.samples) {
  const x = sample.x - tree.offsetX, y = sample.y - tree.offsetY
  if (x < 0 || y < 0 || x >= tree.width || y >= tree.height) continue
  const p = (y * tree.width + x) * 4
  if (tree.data[p + 3]) occlusion.push({ x: sample.x, y: sample.y, rgb: [...tree.data.subarray(p, p + 3)] })
}
if (!occlusion.length) throw new Error('Independent background-depth occlusion fixture is empty')
const bundle = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/border-post-browser.ts')], target: 'browser' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Border renderer fixture build failed')
const js = await bundle.outputs[0]!.text(), assetRoot = resolve(root, 'public/assets/settlers-original')
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } })
  if (path === '/expected.json') return Response.json({ variants, occlusion })
  if (path.startsWith('/assets/settlers-original/')) {
    const file = resolve(assetRoot, decodeURIComponent(path.slice('/assets/settlers-original/'.length)))
    return file.startsWith(assetRoot + sep) ? new Response(Bun.file(file)) : new Response('Invalid asset path', { status: 400 })
  }
  return new Response('<!doctype html><canvas width="800" height="480" style="width:800px;height:480px"></canvas><pre id="result">Preparing</pre><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } })
} })
try {
  const driver = resolve(dirname(Bun.resolveSync('@stacksjs/defaults/package.json', root)), 'ai/skills/stacks-browse/scripts/browse.ts'), reports = [], captures = []
  for (const scale of [1, 2]) {
    const capture = resolve(directory, `border-posts-${scale}.png`)
    const steps = [{ action: 'assert', selector: '#result', text: '"ok":true', timeoutMs: 30000 }, { action: 'evaluate', expression: 'JSON.parse(document.querySelector("#result").textContent)' }]
    const child = Bun.spawn([process.execPath, driver, 'scenario', server.url.href, '--viewport', '900x600', '--scale', String(scale), '--out', capture, ...steps.flatMap(step => ['--step', JSON.stringify(step)])], { stdout: 'pipe', stderr: 'pipe', timeout: 60000 })
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const report = JSON.parse(out); reports.push({ scale, code, report })
    await writeFile(resolve(shots, 'border-posts.json'), `${JSON.stringify(reports, null, 2)}\n`)
    if (err) console.error(err)
    const value = report.steps[1]?.value
    if (code !== 0 || report.scale !== scale || value?.ok !== true || value.deviceScale !== scale || ['consoleErrors', 'failedRequests', 'collectionErrors'].some(key => report[key]?.length !== 0)) throw new Error(`Border renderer failed at scale ${scale}`)
    const image = await readFile(capture)
    if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== 900 * scale || image.readUInt32BE(20) !== 600 * scale) throw new Error('Border capture has invalid device-pixel dimensions')
    captures.push({ scale, screenshot: { sha256: Bun.SHA256.hash(image, 'hex'), bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) } })
    console.log(`Original border post colors, anchors, background depth and fog passed at scale ${scale}: ${value.pixels} independent source pixels.`)
  }
  await writeFile(resolve(shots, 'border-posts-media.json'), `${JSON.stringify({ schemaVersion: 1, captures, scope: 'Production renderer, independent original DAT pixels and authored public-session scenarios. Not original Gold observations.', rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
}
finally { server.stop(true) }
