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
const directory = await mkdtemp(resolve(shots, 'working-area-'))
const capture = resolve(directory, 'working-area.png')
// Use the real building controls and an actual staffed woodcutter.
// This checks browser command delivery, not original-game numeric observations.
const reading = (phase: string) => `(() => {
  const match = document.querySelector('.working-area').textContent.match(/tile (\\d+), (\\d+)\\. Radius (\\d+)/);
  if (!match) throw new Error('The inspector did not display its actual working area');
  return { phase: '${phase}', workingArea: { x: Number(match[1]), y: Number(match[2]), radius: Number(match[3]) } };
})()`
const mapMode = (instruction: string) => ({ action: 'evaluate', expression: `(() => {
  const label = document.querySelector('.island-map').getAttribute('aria-label');
  if (!label.includes(${JSON.stringify(instruction)})) throw new Error('The map announces a stale command: ' + label);
  return { mapInstruction: label };
})()` })
const steps = [
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: '.building-choice', text: "Woodcutter's hut" },
  mapMode("Press Enter to place Woodcutter's hut."),
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: "Woodcutter's hut site placed." },
  { action: 'click', selector: '.map-button', text: '4x' },
  { action: 'assert', selector: '.inspector .worker-line', text: 'woodcutter #', timeoutMs: 30000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: '.inspector button', text: 'Set working area' },
  { action: 'assert', selector: '.island-map', focused: true },
  mapMode('Press Enter to set the working area. Escape cancels.'),
  { action: 'evaluate', expression: reading('before') },
  { action: 'press', key: 'ArrowRight' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Working area moved.' },
  { action: 'evaluate', expression: reading('moved') },
  { action: 'click', selector: '.inspector button', text: 'Set working area' },
  { action: 'press', key: 'ArrowRight' },
  { action: 'press', key: 'Escape' },
  mapMode('Press Enter to inspect.'),
  { action: 'press', key: 'ArrowLeft' },
  { action: 'press', key: 'ArrowLeft' },
  { action: 'press', key: 'Enter' },
  { action: 'evaluate', expression: reading('cancelled') },
  { action: 'click', selector: '.inspector button', text: 'Set working area' },
  { action: 'evaluate', expression: `(() => {
    const canvas = document.querySelector('.island-map');
    const area = document.querySelector('.working-area').textContent.match(/tile (\\d+), (\\d+)\\. Radius (\\d+)/);
    const distance = Number(area[3]) * 3 + 2, key = Number(area[1]) > distance ? 'ArrowLeft' : 'ArrowRight';
    for (let i = 0; i < distance; i++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    return { input: 'Browser DOM keyboard events beyond the declared working-area range' };
  })()` },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'That working area is too far away.' },
  { action: 'evaluate', expression: reading('rejected') },
  { action: 'click', selector: '.inspector button', text: 'Set working area' },
  { action: 'press', key: 'Escape' },
  { action: 'press', key: 'ArrowLeft' },
  { action: 'press', key: 'Enter' },
  { action: 'evaluate', expression: `(async () => {
    const canvas = document.querySelector('.island-map');
    const moved = document.querySelector('.working-area').textContent.match(/tile (\\d+), (\\d+)/);
    const target = { x: Number(moved[1]) - 1, y: Number(moved[2]) };
    const key = key => canvas.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    const button = text => [...document.querySelectorAll('header button')].find(button => button.textContent.trim() === text);
    const wait = async text => {
      const deadline = performance.now() + 2000;
      while (!document.querySelector('[role=status]').textContent.includes(text)) {
        if (performance.now() >= deadline) throw new Error('Checkpoint acknowledgement did not arrive: ' + text);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    button('Save').click(); await wait('Settlement saved on this device.');
    button('Load').click(); await wait('Saved settlement restored.');
    key('ArrowRight');
    const tile = canvas.getAttribute('aria-label').match(/Tile (\\d+), (\\d+)/);
    const at = { x: Number(tile[1]), y: Number(tile[2]) };
    while (at.x !== target.x) { key(at.x < target.x ? 'ArrowRight' : 'ArrowLeft'); at.x += at.x < target.x ? 1 : -1; }
    while (at.y !== target.y) { key(at.y < target.y ? 'ArrowDown' : 'ArrowUp'); at.y += at.y < target.y ? 1 : -1; }
    key('Enter');
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { checkpointAcknowledged: true, input: 'Browser DOM buttons and keyboard events' };
  })()` },
  { action: 'evaluate', expression: reading('restored') },
  { action: 'click', selector: '.inspector button', text: 'Pause work' },
  { action: 'assert', selector: '.inspector .building-status', text: 'Work paused' },
  { action: 'click', selector: '.inspector button', text: 'Resume work' },
  { action: 'assert', selector: '.inspector button', text: 'Pause work' },
  { action: 'click', selector: '.inspector button', text: 'Set working area' },
  mapMode('Press Enter to set the working area. Escape cancels.'),
  { action: 'click', selector: '.island-map' },
  { action: 'assert', selector: '[role=status]', text: 'Working area moved.' },
  mapMode('Press Enter to inspect.'),
  { action: 'click', selector: '.main-menu button', text: 'Settlers' },
  { action: 'click', selector: '.category-list button', text: 'Occupations' },
  { action: 'click', selector: '.specialists button', text: 'Pioneer' },
  mapMode('Press Enter to send a pioneer. Escape cancels.'),
  { action: 'press', key: 'Escape' },
  { action: 'click', selector: '.specialists button', text: 'Geologist' },
  mapMode('Press Enter to send a geologist. Escape cancels.'),
  { action: 'press', key: 'Escape' },
  { action: 'click', selector: '.category-list button', text: 'Military' },
  { action: 'click', selector: '.specialists button', text: 'Send soldiers' },
  mapMode('Press Enter to send soldiers. Escape cancels.'),
  { action: 'press', key: 'Escape' },
  mapMode('Press Enter to inspect.'),
]
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', '1440x960', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 120000 })
const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'working-area.json'), out)
if (err) console.error(err)
if (code !== 0) throw new Error(`Working-area browser check failed. See ${shots}/working-area.json`)
const report = JSON.parse(out)
const values = Object.fromEntries(report.steps.filter((step: { value?: { workingArea?: unknown } }) => step.value?.workingArea).map((step: { value: { phase: string, workingArea: { x: number, y: number, radius: number } } }) => [step.value.phase, step.value.workingArea]))
const before = values.before, moved = values.moved
if (moved.x !== before.x + 1 || moved.y !== before.y || moved.radius !== before.radius) throw new Error('The accepted command did not move the displayed working area by one tile')
for (const phase of ['cancelled', 'rejected', 'restored']) {
  if (JSON.stringify(values[phase]) !== JSON.stringify(moved)) throw new Error(`The working area changed after ${phase}`)
}
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Working-area acceptance did not produce a new PNG')
await writeFile(resolve(shots, 'working-area-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  rasterPublication: 'withheld-pending-redistribution-evidence',
  inputDelivery: 'Native driver keys and clicks, with DOM buttons and keyboard events for bounded save/load acknowledgement and map reselection.',
}, null, 2)}\n`)
console.log('The browser working-area control passed.')
