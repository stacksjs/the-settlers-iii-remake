import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const url = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const capture = resolve(await mkdtemp(resolve(shots, 'selection-')), 'selection.png')

// The first idle carrier starts at the castle door (-1, +3). Its projected
// sprite centre is (-40, +13) from the centred castle at 100% zoom. Assert the
// actual selection message before testing cancellation, so a missed hit fails.
// PointerEvents enter the real browser DOM listeners; the driver supplies the
// initial native mouse click, Escape and numbered recall keys. This does not
// test pointer capture.
const pointer = (x: number, y: number, button = 0) => `(() => {
  const canvas = document.querySelector('.island-map'), rect = canvas.getBoundingClientRect();
  const point = { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true,
    clientX: rect.left + rect.width / 2 + ${x}, clientY: rect.top + rect.height / 2 + ${y}, button: ${button} };
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...point, buttons: ${button === 2 ? 2 : 1} }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...point, buttons: 0 }));
  return { input: 'browser DOM PointerEvent', button: ${button} };
})()`
const steps = [
  { action: 'assert', selector: '.building-choice', text: 'Sawmill', timeoutMs: 10000 },
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: '.main-menu button', text: 'Settlers' },
  { action: 'click', selector: '.category-list button', text: 'Occupations' },
  { action: 'click', selector: 'button[title="Turn a carrier into a thief"]' },
  { action: 'assert', selector: '[role=status]', text: 'A carrier became a thief.' },
  { action: 'click', selector: '.island-map' },
  { action: 'evaluate', expression: pointer(-40, 13) },
  { action: 'assert', selector: '[role=status]', text: 'Thief marked.' },
  { action: 'press', key: 'Escape' },
  { action: 'evaluate', expression: pointer(120, -80, 2) },
  { action: 'assert', selector: '[role=status]', text: 'Mark soldiers first' },
  { action: 'evaluate', expression: pointer(-40, 13) },
  { action: 'assert', selector: '[role=status]', text: 'Thief marked.' },
  { action: 'press', key: '1' },
  { action: 'assert', selector: '[role=status]', text: 'Group 1 is empty.' },
  { action: 'evaluate', expression: pointer(120, -80, 2) },
  { action: 'assert', selector: '[role=status]', text: 'Mark soldiers first' },
  { action: 'evaluate', expression: pointer(-40, 13) },
  { action: 'assert', selector: '[role=status]', text: 'Thief marked.' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 },
  { action: 'click', selector: 'header button', text: 'Load' },
  { action: 'assert', selector: '[role=status]', text: 'Saved settlement restored.', timeoutMs: 2000 },
  { action: 'evaluate', expression: pointer(120, -80, 2) },
  { action: 'assert', selector: '[role=status]', text: 'Mark soldiers first' },
]
steps.push(
  { action: 'evaluate', expression: pointer(-40, 13) },
  { action: 'assert', selector: '[role=status]', text: 'Thief marked.' },
  { action: 'evaluate', expression: `(() => {
    const canvas = document.querySelector('.island-map'), rect = canvas.getBoundingClientRect();
    const point = { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, button: 0,
      clientX: rect.left + rect.width / 2 + 100, clientY: rect.top + rect.height / 2 - 100 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...point, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...point, clientX: point.clientX + 40, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...point, clientX: point.clientX + 40, buttons: 0 }));
    return { input: 'browser DOM PointerEvent rectangle' };
  })()` },
  { action: 'assert', selector: '[role=status]', text: 'No soldiers in that area.' },
  { action: 'evaluate', expression: pointer(120, -80, 2) },
  { action: 'assert', selector: '[role=status]', text: 'Mark soldiers first' },
)
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, '--viewport', '1280x850', '--out', capture,
  ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
], { stdout: 'pipe', stderr: 'pipe', timeout: 120000 })
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'selection.json'), stdout)
if (stderr) console.error(stderr)
if (code !== 0) throw new Error(`Unit selection failed. See ${shots}/selection.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Selection acceptance did not produce a new PNG')
await writeFile(resolve(shots, 'selection-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  inputDelivery: 'Browser DOM PointerEvents and native driver Digit1 and Escape; pointer capture is outside this check.',
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log('Escape, troop group recall, save/load and rectangle selection clear the marked thief before the next map command.')
