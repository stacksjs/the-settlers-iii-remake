import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { playUrl, signInArgs } from './session'

const base = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const capture = resolve(await mkdtemp(resolve(shots, 'residences-')), 'residences.png')

// Ordinary controls build a residence from the engineering starting supplies.
// Population observations use only the rendered header while world time runs.
const steps = [
  { action: 'assert', selector: '.building-choice', text: 'Sawmill', timeoutMs: 10000 },
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: '.category-list button', text: 'Misc.' },
  { action: 'click', selector: '.building-choice', text: 'Small residence' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Small residence site placed.' },
  { action: 'click', selector: '.map-button', text: '4x' },
  { action: 'assert', selector: '.inspector h2', text: 'Small residence' },
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready', timeoutMs: 30000 },
  { action: 'click', selector: '.inspector button', text: 'Pause work' },
  { action: 'assert', selector: '.inspector .building-status', text: 'Work paused' },
  { action: 'evaluate', expression: `(async () => {
    const population = () => Number(document.querySelector('.population strong').textContent);
    const clock = () => {
      const text = document.querySelector('.day').textContent.trim();
      if (!/^\\d+:\\d{2}$/.test(text)) throw new Error('The visible game clock is invalid');
      const [minutes,seconds] = text.split(':').map(Number);
      const elapsed=minutes*60+seconds;
      if (!Number.isSafeInteger(elapsed) || seconds>59) throw new Error('The visible game clock is invalid');
      return elapsed;
    };
    const before=population(),start=clock(),deadline=performance.now()+15000;
    if (!Number.isSafeInteger(before) || before<1) throw new Error('No visible population');
    while (clock()-start<21 && performance.now()<deadline) {
      if (population()!==before) throw new Error('A paused residence added settlers');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if (clock()-start<21 || population()!==before) throw new Error('Paused population was not retained while world time advanced');
    return {population:before,elapsedGameSeconds:clock()-start,populationRetained:true};
  })()` },
  { action: 'click', selector: '.inspector button', text: 'Resume work' },
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready' },
  { action: 'evaluate', expression: `(async () => {
    const population = () => Number(document.querySelector('.population strong').textContent);
    const before=population(),deadline=performance.now()+10000;
    while (population()===before && performance.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100));
    if (population()!==before+1) throw new Error('The resumed residence did not add its next settler');
    return {before,after:population(),arrivalsResumed:true};
  })()` },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 },
]

const child = Bun.spawn([
  process.execPath, driver, 'scenario', playUrl(base), ...await signInArgs(base), '--viewport', '1440x960', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 120000 })
const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'residences.json'), out)
if (err) console.error(err)
if (code !== 0) throw new Error(`Residence browser check failed. See ${shots}/residences.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Residence acceptance did not capture a new PNG')
await writeFile(resolve(shots, 'residences-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: Bun.SHA256.hash(bytes, 'hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log('Actual residence construction, paused population, resumed arrival and saving passed.')
