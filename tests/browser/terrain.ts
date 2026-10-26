import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'

interface TerrainResult { ok: boolean, error?: string, checkedPixels: number, deviceScale: number }
interface TerrainReport { scale: number, steps: { value?: TerrainResult }[], consoleErrors: unknown[], failedRequests: unknown[], collectionErrors: unknown[] }

const root = resolve(import.meta.dir, '../..'), shots = resolve(root, 'storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'terrain-'))
const bundle = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/terrain-browser.ts')], target: 'browser' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Terrain fixture build failed')
const javascript = await bundle.outputs[0]!.text(), assetRoot = resolve(root, 'public/assets/settlers-original')
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(javascript, { headers: { 'Content-Type': 'text/javascript' } })
  if (path.startsWith('/assets/settlers-original/')) {
    const file = resolve(assetRoot, decodeURIComponent(path.slice('/assets/settlers-original/'.length)))
    return file.startsWith(assetRoot + sep) ? new Response(Bun.file(file)) : new Response('Invalid asset path', { status: 400 })
  }
  return new Response('<!doctype html><canvas width="800" height="480" style="width:800px;height:480px"></canvas><pre id="result">Preparing</pre><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } })
} })
try {
  const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', root)), driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
  const reports: { scale: number, code: number, report: TerrainReport }[] = [], captures = []
  for (const scale of [1, 2]) {
    const capture = resolve(directory, `terrain-${scale}.png`)
    const steps = [{ action: 'assert', selector: '#result', text: '"ok":', timeoutMs: 30000 }, { action: 'evaluate', expression: 'JSON.parse(document.querySelector("#result").textContent)' }]
    const child = Bun.spawn([process.execPath, driver, 'scenario', `http://127.0.0.1:${server.port}/`, '--viewport', '900x600', '--scale', String(scale), '--out', capture, ...steps.flatMap(step => ['--step', JSON.stringify(step)])], { stdout: 'pipe', stderr: 'pipe', timeout: 60000 })
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const report = JSON.parse(out) as TerrainReport; reports.push({ scale, code, report })
    await writeFile(resolve(shots, 'terrain.json'), `${JSON.stringify(reports, null, 2)}\n`)
    if (err) console.error(err)
    if (code !== 0) throw new Error(`Terrain browser driver failed at scale ${scale}; see retained report`)
    const value = report.steps[1]?.value
    if (value?.ok !== true) throw new Error(`Terrain browser checks failed at scale ${scale}: ${value?.error ?? 'missing result'}`)
    if (report.scale !== scale || value.deviceScale !== scale) throw new Error(`Terrain device scale ${value.deviceScale} or driver scale ${report.scale} differs from requested ${scale}`)
    for (const key of ['consoleErrors', 'failedRequests', 'collectionErrors'] as const) {
      if (!Array.isArray(report[key]) || report[key].length !== 0) throw new Error(`Terrain browser observations contain ${key}`)
    }
    const image = await readFile(capture)
    if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== 900 * scale || image.readUInt32BE(20) !== 600 * scale) throw new Error('Terrain screenshot does not match the requested device-pixel dimensions')
    captures.push({ scale, screenshot: { sha256: Bun.SHA256.hash(image, 'hex'), bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) } })
    console.log(`Terrain reference UV, vertex light, coverage, fog, overlap and resource checks passed at scale ${scale} (${value.checkedPixels} pixels).`)
  }
  await writeFile(resolve(shots, 'terrain-media.json'), `${JSON.stringify({ schemaVersion: 1, captures, scope: 'Production terrain renderer and independent exact source-texel/native-pattern checks in two real device-scale contexts. Not original Gold observations.', rasterPublication: 'withheld-pending-redistribution-evidence' }, null, 2)}\n`)
}
finally { server.stop(true) }
