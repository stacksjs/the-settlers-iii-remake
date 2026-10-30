import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { playUrl, signInArgs } from './session'

const base = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const url = playUrl(base)
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const capture = resolve(await mkdtemp(resolve(shots, 'rival-battle-')), 'rival-battle.png')

// Production pacing: ten real minutes at the player's ordinary 4x setting.
// No injected session, clock override, special stock or extra simulation speed.
const steps: Record<string, unknown>[] = [
  { action: 'assert', selector: '.building-choice', text: 'Sawmill', timeoutMs: 10000 },
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: 'header button', text: 'New settlement' },
  { action: 'fill', selector: '#map-seed', value: '2' },
  { action: 'click', selector: '.restart-panel button', text: 'Computer rival' },
  { action: 'assert', selector: '.campaign-name', text: 'Computer rival', timeoutMs: 10000 },
  { action: 'assert', selector: '.map-seed', text: 'Map seed 2' },
  { action: 'assert', selector: '.objectives[data-outcome=playing]', text: 'Objectives' },
  { action: 'click', selector: '.map-button', text: '4x' },
]
for (let interval = 1; interval <= 20; interval++) {
  steps.push({ action: 'wait', ms: 30000 })
  if (interval % 2 === 0) steps.push({ action: 'evaluate', expression: `(() => ({
    realMinutes: ${interval / 2},
    time: document.querySelector('.day').textContent,
    seed: document.querySelector('.map-seed').textContent,
    outcome: document.querySelector('.objectives').dataset.outcome,
    population: document.querySelector('.population strong').textContent,
  }))()` })
}
steps.push(
  { action: 'assert', selector: '.objectives[data-outcome=lost] h2', text: 'Mission lost', timeoutMs: 10000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 5000 },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '.map-seed', text: 'Map seed 2', timeoutMs: 10000 },
  { action: 'assert', selector: '.objectives[data-outcome=lost] h2', text: 'Mission lost', timeoutMs: 10000 },
)
const started = performance.now()
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', '1440x960', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 720000 })
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'rival-battle.json'), stdout)
if (stderr) console.error(stderr)
if (code !== 0) throw new Error(`Full rival battle failed. See ${shots}/rival-battle.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Rival battle did not produce a new PNG')
await writeFile(resolve(shots, 'rival-battle-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  elapsedMs: performance.now() - started,
  screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  inputDelivery: 'Maintained browser driver, normal map-seed field and 4x control, ten real minutes, ordinary save and document reload.',
  evidenceLimit: 'One passive-player defeat in the Roman engineering profile. It does not establish human victory, original Gold rules or every map seed.',
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log('The rival completed a production-paced seeded browser battle and its outcome survived save/reload.')
