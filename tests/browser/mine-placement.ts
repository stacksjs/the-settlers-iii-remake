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
const capture = resolve(await mkdtemp(resolve(shots, 'mine-placement-')), 'mine-placement.png')
// Real controls verify that an unsurveyed mine suggestion warns before the
// player spends goods, while retaining legal speculative construction.
const steps = [
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: 'header button', text: 'New settlement' },
  { action: 'fill', selector: '#map-seed', value: '1' },
  { action: 'click', selector: '.restart-panel button', text: 'Computer rival' },
  { action: 'assert', selector: '.campaign-name', text: 'Computer rival', timeoutMs: 10000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: '.building-choice', text: 'Iron mine' },
  { action: 'assert', selector: '[role=status]', text: 'This site has no known matching deposit in reach. Send a geologist to survey or choose another site.' },
  { action: 'press', key: 'Escape' },
  { action: 'click', selector: '.building-choice', text: 'Coal mine' },
  { action: 'assert', selector: '[role=status]', text: 'This site has no known matching deposit in reach.' },
  { action: 'press', key: 'Escape' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 5000 },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.', timeoutMs: 10000 },
  { action: 'click', selector: '.building-choice', text: 'Iron mine' },
  { action: 'assert', selector: '[role=status]', text: 'This site has no known matching deposit in reach.' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Iron mine site placed.' },
  { action: 'press', key: 'Escape' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '.inspector h2', text: 'Iron mine' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 5000 },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.', timeoutMs: 10000 },
  { action: 'assert', selector: '.campaign-name', text: 'Computer rival' },
]
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', '1440x960', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 120000 })
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'mine-placement.json'), stdout)
if (stderr) console.error(stderr)
if (code !== 0) throw new Error(`Mine placement browser acceptance failed. See ${shots}/mine-placement.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Mine placement acceptance did not produce a new PNG')
await writeFile(resolve(shots, 'mine-placement-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  inputDelivery: 'Maintained browser driver clicks and document reload. No session mutation or injected save.',
  evidenceLimit: 'Unsurveyed mine warnings, retained speculative placement and save/reload. Surveyed productive sites are verified through public session tests.',
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log('Unsurveyed mine warnings, speculative construction and save/reload passed.')
