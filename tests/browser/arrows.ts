import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'
import { referenceCompose, referenceFrames, referenceImage } from '../fixtures/reference-dat'

const root = resolve(import.meta.dir, '../..'), shots = resolve(root, 'storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'arrows-'))
const bytes = Buffer.from(await Bun.file(resolve(root, 'storage/reference/demo/Gfx/Siedler3_01.f8007e01f.dat')).bytes())
const directions = [
  { name: 'north-east', sequence: 103 }, { name: 'east', sequence: 104 }, { name: 'south-east', sequence: 105 },
  { name: 'south-west', sequence: 100 }, { name: 'west', sequence: 101 }, { name: 'north-west', sequence: 102 },
]
const encode = (image: ReturnType<typeof referenceImage>) => ({ ...image, data: Array.from(image.data) })
const poses = directions.flatMap(direction => [0, 1, 2].map(frame => ({
  sprite: `arrow:${direction.name}`, frame,
  body: encode(referenceImage(bytes, referenceFrames(bytes, 0x106, direction.sequence)[frame]!)),
  shadow: encode(referenceImage(bytes, referenceFrames(bytes, 0x5982, direction.sequence - 2)[frame]!, 'shadow')),
})))
const trees = Object.fromEntries([1, 2, 4, 7, 8, 16, 17].map((sequence, index) => [`tree-${index}`, encode(referenceImage(bytes, referenceFrames(bytes, 0x106, sequence)[0]!))]))
const manifest = await Bun.file(resolve(root, 'public/assets/settlers-original/manifest.json')).json()
const sourceNames = await readdir(resolve(root, 'storage/reference/demo/Gfx')), files = new Map<number, Buffer>()
const masks: Record<string, { body: ReturnType<typeof encode>, shadow: ReturnType<typeof encode> | null }[]> = {}
for (const sprite of ['soldier:bowman-1', 'strike:bowman-1', 'soldier:pikeman-1', 'strike:pikeman-1']) {
  masks[sprite] = []
  for (const frame of manifest.sprites.filter((frame: { key: string }) => frame.key === sprite)) {
    const decode = async (record: typeof frame) => {
      const source = record.source
      if (!files.has(source.file)) {
        const name = sourceNames.find(name => name.toLowerCase() === `siedler3_${String(source.file).padStart(2, '0')}.f8007e01f.dat`)
        if (!name) throw new Error('Original actor source missing')
        files.set(source.file, Buffer.from(await Bun.file(resolve(root, 'storage/reference/demo/Gfx', name)).bytes()))
      }
      const bytes = files.get(source.file)!
      return referenceImage(bytes, referenceFrames(bytes, source.section, source.actualSequence)[source.frame]!, source.section === 0x5982 ? 'shadow' : source.section === 0x3112)
    }
    const body = await decode(frame), torso = frame.torso ? manifest.sprites.find((record: { key: string, frame: number }) => record.key === frame.torso && record.frame === frame.frame) : null
    const shadow = frame.shadow ? manifest.sprites.find((record: { key: string, frame: number }) => record.key === frame.shadow && record.frame === frame.frame) : null
    const combined = torso ? referenceCompose([await decode(torso), body]) : body
    masks[sprite]!.push({ body: encode(combined), shadow: shadow ? encode(await decode(shadow)) : null })
  }
}
const bundle = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/arrow-browser.ts')], target: 'browser' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Arrow renderer fixture build failed')
const js = await bundle.outputs[0]!.text(), assetRoot = resolve(root, 'public/assets/settlers-original')
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } })
  if (path === '/expected.json') return Response.json({ poses, trees, masks })
  if (path.startsWith('/assets/settlers-original/')) {
    const file = resolve(assetRoot, decodeURIComponent(path.slice('/assets/settlers-original/'.length)))
    return file.startsWith(assetRoot + sep) ? new Response(Bun.file(file)) : new Response('Invalid asset path', { status: 400 })
  }
  return new Response('<!doctype html><canvas width="400" height="280" style="width:400px;height:280px"></canvas><pre id="result">Preparing</pre><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } })
} })
try {
  const driver = resolve(dirname(Bun.resolveSync('@stacksjs/defaults/package.json', root)), 'ai/skills/stacks-browse/scripts/browse.ts'), reports = [], captures = []
  for (const scale of [1, 2]) {
    const capture = resolve(directory, `arrows-${scale}.png`)
    const steps = [{ action: 'assert', selector: '#result', text: '"ok":', timeoutMs: 30000 }, { action: 'evaluate', expression: 'JSON.parse(document.querySelector("#result").textContent)' }]
    const child = Bun.spawn([process.execPath, driver, 'scenario', server.url.href, '--viewport', '900x600', '--scale', String(scale), '--out', capture, ...steps.flatMap(step => ['--step', JSON.stringify(step)])], { stdout: 'pipe', stderr: 'pipe', timeout: 60000 })
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const report = JSON.parse(out); reports.push({ scale, code, report })
    await writeFile(resolve(shots, 'arrows.json'), `${JSON.stringify(reports, null, 2)}\n`)
    if (err) console.error(err)
    const value = report.steps[1]?.value
    if (code !== 0 || report.scale !== scale || value?.ok !== true || value.deviceScale !== scale || ['consoleErrors', 'failedRequests', 'collectionErrors'].some(key => report[key]?.length !== 0)) throw new Error(`Arrow renderer failed at scale ${scale}`)
    const image = await readFile(capture)
    if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== 900 * scale || image.readUInt32BE(20) !== 600 * scale) throw new Error('Arrow capture has invalid device-pixel dimensions')
    captures.push({ scale, screenshot: { sha256: Bun.SHA256.hash(image, 'hex'), bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) } })
    console.log(`Original arrow frames, mapped shadows, anchors, elevation and depth passed at scale ${scale}: ${value.pixels} exact pixel comparisons.`)
  }
  await writeFile(resolve(shots, 'arrows-media.json'), `${JSON.stringify({ schemaVersion: 1, captures, scope: 'Production renderer, independent original DAT pixels and authored public-session scenarios. Not original Gold observations.', rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
}
finally { server.stop(true) }
