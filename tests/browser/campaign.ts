import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { campaignSteps } from './campaign-steps'
import { playUrl, signInArgs } from './session'

const base = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const url = playUrl(base)
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const capture = resolve(await mkdtemp(resolve(shots, 'campaign-')), 'campaign.png')

let reachable = false
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) { reachable = true; break }
  }
  catch { /* The production server may still be starting. */ }
  await Bun.sleep(500)
}
if (!reachable) throw new Error(`Production server did not become ready: ${url}`)

const browserProcess = Bun.spawn([
  process.execPath, driver, 'scenario', url, ...await signInArgs(base),
  '--viewport', '1440x960', '--out', capture,
  ...campaignSteps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe' })
const [code, output, errors] = await Promise.all([
  browserProcess.exited, new Response(browserProcess.stdout).text(), new Response(browserProcess.stderr).text(),
])
await writeFile(resolve(shots, 'campaign.json'), output)
// Preserve the real raster locally for QA. Public CI retains only its identity
// until the content policy records permission for publishing original media.
let screenshot: Buffer | null = null
try { screenshot = await readFile(capture) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const valid = screenshot !== null && screenshot.length >= 24
  && screenshot.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  && screenshot.toString('ascii', 12, 16) === 'IHDR'
await writeFile(resolve(shots, 'campaign-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: screenshot && valid ? { sha256: new Bun.CryptoHasher('sha256').update(screenshot).digest('hex'), bytes: screenshot.length, width: screenshot.readUInt32BE(16), height: screenshot.readUInt32BE(20) } : null,
  captureStatus: screenshot ? valid ? 'captured' : 'invalid' : 'not-captured',
  browserExitCode: code,
  rasterPublication: 'withheld-pending-redistribution-evidence',
  evidenceLimit: valid ? 'This receipt identifies a locally captured screenshot. It does not provide public visual inspection.' : 'No valid screenshot was captured during this run. Older rasters do not supply evidence for this execution.',
}, null, 2)}\n`)
if (errors) console.error(errors)
if (code !== 0) throw new Error(`Production campaign browser check failed. See ${shots}/campaign.json`)
if (!valid) throw new Error('The browser did not capture a new campaign PNG during this run')
console.log('Production campaign verified: keyboard construction, speed, pause, audio, background save and reload.')
