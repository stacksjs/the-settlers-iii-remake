import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { campaignSteps } from './campaign-steps'

const url = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })

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
  process.execPath, driver, 'scenario', url,
  '--viewport', '1440x960', '--out', resolve(shots, 'campaign.png'),
  ...campaignSteps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe' })
const [code, output, errors] = await Promise.all([
  browserProcess.exited, new Response(browserProcess.stdout).text(), new Response(browserProcess.stderr).text(),
])
await writeFile(resolve(shots, 'campaign.json'), output)
if (errors) console.error(errors)
if (code !== 0) throw new Error(`Production campaign browser check failed. See ${shots}/campaign.json`)
console.log('Production campaign verified: keyboard construction, speed, pause, durable save and reload.')
