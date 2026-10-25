import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const url = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'production-'))
const capture = resolve(directory, 'production.png')
// These are the declared engineering start and sawmill costs, not original-game observations.
// Drive the real controls and compare their displayed accounting before and after reload.
const steps = [
  { action: 'assert', selector: '.building-choice', text: 'Sawmill', timeoutMs: 10000 },
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: '.building-choice', text: 'Sawmill' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Sawmill site placed.' },
  { action: 'click', selector: '.map-button', text: '4x' },
  { action: 'assert', selector: '.inspector .worker-line', text: 'sawyer #', timeoutMs: 30000 },
  { action: 'assert', selector: '.inspector .building-status', text: 'Doorstep full', timeoutMs: 30000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: '.main-menu button', text: 'Settlers' },
  { action: 'click', selector: '.category-list button', text: 'Production statistics' },
  { action: 'evaluate', expression: `(() => {
   const row = name => [...document.querySelectorAll('.production-table tbody tr')].find(row => row.querySelector('th').textContent.trim() === name);
   const data = name => Object.fromEntries([...row(name).querySelectorAll('[data-figure]')].map(cell => [cell.dataset.figure, Number(cell.textContent)]));
   const plank=data('plank'),log=data('log'),stone=data('stone');
   if(plank.produced!==8 || plank.consumed!==3 || plank.stock!==35 || log.consumed!==8 || log.stock!==0 || stone.consumed!==4 || stone.stock!==22)throw new Error('Production figures disagree with the supplied sawmill: '+JSON.stringify({plank,log,stone}));
   return {plank,log,stone,realWorkerAndBackpressure:true};
 })()`},
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.', timeoutMs: 10000 },
  { action: 'click', selector: '.main-menu button', text: 'Settlers' },
  { action: 'click', selector: '.category-list button', text: 'Production statistics' },
  { action: 'evaluate', expression: `(() => {
   const row=[...document.querySelectorAll('.production-table tbody tr')].find(row=>row.querySelector('th').textContent.trim()==='plank');
   const produced=Number(row.querySelector('[data-figure=produced]').textContent), stock=Number(row.querySelector('[data-figure=stock]').textContent);
   if(produced!==8 || stock!==35)throw new Error('A reload lost production or physical stock');
   return {produced,stock,productionSurvivesReload:true};
 })()`},
]
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, '--viewport', '1440x960', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 120000 })
const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'production.json'), out)
if (err) console.error(err)
if (code !== 0) throw new Error(`Production browser check failed. See ${shots}/production.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Production acceptance did not produce a new PNG')
await writeFile(resolve(shots, 'production-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log('Actual browser construction, staffed production, backpressure, accounting and save/reload passed.')
