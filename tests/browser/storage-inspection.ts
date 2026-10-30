import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { playUrl, signInArgs } from './session'

const base = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const url = playUrl(base)
const driver = resolve(dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd())), 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const capture = resolve(await mkdtemp(resolve(shots, 'storage-inspection-')), 'storage-inspection.png')
// Normal seed, placement, chronicle centering, keyboard and native pointer input.
// No session, save, clock or controller injection. This is an engineering game
// acceptance scenario, not a measurement from the original Gold executable.
const showStorage = { action: 'click', selector: '.chronicle p button', text: 'Show' }
const panel = { action: 'assert', selector: '.inspector h2', text: 'Storage area' }
const construction = { action: 'evaluate', expression: `(() => {
  const status = document.querySelector('.inspector .building-status').textContent;
  if (!/Diggers are levelling|Builders are at work/.test(status)) throw new Error('Expected an actual construction site: ' + status);
  return { status, instruction: document.querySelector('.island-map').getAttribute('aria-label') };
})()` }
const steps: Record<string, unknown>[] = [
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: 'header button', text: 'New settlement' },
  { action: 'fill', selector: '#map-seed', value: '5' },
  { action: 'click', selector: '.restart-panel button', text: 'Generated landscape' },
  { action: 'assert', selector: '.map-seed', text: 'Map seed 5', timeoutMs: 10000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: '.category-list button', text: 'Misc.' },
  { action: 'click', selector: '.building-choice', text: 'Storage area' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Storage area site placed.' },
  { action: 'press', key: 'Escape' },
  { action: 'assert', selector: '.inspector', absent: true },
  { action: 'press', key: 'Enter' },
  panel, construction,
  { action: 'press', key: 'Escape' },
  showStorage,
  { action: 'click', selector: '.island-map' },
  panel, construction,
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.', timeoutMs: 10000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'focus', selector: '.island-map' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '.inspector h2', text: 'Castle' },
  showStorage,
  { action: 'click', selector: '.island-map' },
  panel, construction,
  { action: 'click', selector: '.map-button', text: '4x' },
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready', timeoutMs: 30000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'focus', selector: '.island-map' },
  { action: 'press', key: 'Escape' },
  { action: 'press', key: 'Enter' },
  panel,
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready' },
  { action: 'press', key: 'Escape' },
  showStorage,
  { action: 'click', selector: '.island-map' },
  panel,
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 },
  { action: 'click', selector: 'header button', text: 'Load' },
  { action: 'assert', selector: '[role=status]', text: 'Saved settlement restored.', timeoutMs: 2000 },
  showStorage,
  { action: 'click', selector: '.island-map' },
  panel,
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready' },
  ...Array.from({ length: 32 }, () => ({ action: 'press', key: 'ArrowUp' })),
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '.inspector', absent: true },
]
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', '1440x960', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 180000 })
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'storage-inspection.json'), stdout)
if (stderr) console.error(stderr)
if (code !== 0) throw new Error(`Storage inspection failed. See ${shots}/storage-inspection.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Storage inspection did not produce a new PNG')
await writeFile(resolve(shots, 'storage-inspection-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: Bun.SHA256.hash(bytes, 'hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  inputDelivery: 'Maintained browser driver, native pointer at the chronicle-centered canvas and native keyboard input. Normal construction, cold reload and save/load.',
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log(`Storage construction, completion, keyboard and pointer inspection, empty-ground clearing and reload passed (${steps.length} steps).`)
