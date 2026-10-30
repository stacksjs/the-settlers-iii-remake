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
const directory = await mkdtemp(resolve(shots, 'resize-'))
const capture = resolve(directory, 'resize.png')
const expression = `(async () => {
  const canvas = document.querySelector('.island-map'), context = canvas.getContext('2d');
  const frames = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
  await frames();
  const initial = canvas.getBoundingClientRect(), ratio = canvas.width / initial.width;
  const size = 96 * ratio;
  const sample = () => context.getImageData(Math.round((canvas.width - size) / 2), Math.round((canvas.height - size) / 2), size, size).data;
  const before = sample();
  if (new Set(before).size < 50) throw new Error('The starting view must contain the actual rendered settlement');
  const checks = [];
  const resize = async (width, height) => {
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    const start = performance.now();
    while (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      if (performance.now() - start > 2000) throw new Error('The real canvas ResizeObserver did not update its backing store');
      await frames();
    }
    await frames();
    const after = sample();
    const different = after.reduce((n, channel, i) => n + Number(channel !== before[i]), 0);
    if (different) throw new Error('Resizing moved the settlement away from the view centre: ' + different + ' changed channels at ' + width + 'x' + height);
    checks.push({ width, height, identicalCentreChannels: after.length });
  };
  await resize(920, 500);
  canvas.style.display = 'none';
  await frames();
  canvas.style.display = '';
  await frames();
  await resize(640, 420);
  await resize(initial.width, initial.height);
  canvas.style.width = ''; canvas.style.height = '';
  await frames();
  return { realCanvasResizeObserver: true, hiddenMapRestored: true, checks };
})()`
const child = Bun.spawn([
  process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', '1280x850', '--out', capture,
  '--step', JSON.stringify({ action: 'assert', selector: 'header button', text: 'Save', timeoutMs: 10000 }),
  '--step', JSON.stringify({ action: 'wait', ms: 1500 }),
  '--step', JSON.stringify({ action: 'click', selector: '.map-button', text: 'Pause' }),
  '--step', JSON.stringify({ action: 'click', selector: '[aria-label="Center on the castle"]' }),
  '--step', JSON.stringify({ action: 'evaluate', expression }),
], { stdout: 'pipe', stderr: 'pipe' })
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(resolve(shots, 'resize.json'), stdout)
if (stderr) console.error(stderr)
if (code !== 0) throw new Error(`Settlement resize failed. See ${shots}/resize.json`)
const bytes = await readFile(capture)
if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Resize acceptance did not produce a new PNG')
await writeFile(resolve(shots, 'resize-media.json'), `${JSON.stringify({
  schemaVersion: 1,
  screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  rasterPublication: 'withheld-pending-redistribution-evidence',
}, null, 2)}\n`)
console.log('Settlement view preserved across three real canvas resizes, with identical centre pixels.')
