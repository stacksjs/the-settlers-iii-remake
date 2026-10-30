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
const directory = await mkdtemp(resolve(shots, 'recruitment-'))
// Build a barracks through the actual map controls. No weapons exist at the
// start, so recruitment orders wait without creating soldiers or goods.
const queued = (count: number) => ({ action: 'evaluate', expression: `(() => {
  const row = document.querySelector('[data-profession=swordsman]');
  const cancel = row.querySelector('button[title="Cancel one waiting order"]');
  if (!row.textContent.includes('(${count} ordered)') || cancel.disabled) throw new Error('Waiting recruitment count or cancellation is stale');
  return { waiting: ${count}, canCancel: true };
})()` })
const empty = { action: 'evaluate', expression: `(() => {
  const row = document.querySelector('[data-profession=swordsman]');
  if (row.textContent.includes('ordered') || !row.querySelector('button[title="Cancel one waiting order"]').disabled) throw new Error('An empty recruitment queue can still be cancelled');
  return { waiting: 0, canCancel: false };
})()` }
const steps = [
  { action: 'assert', selector: '.building-choice:disabled', absent: true, timeoutMs: 10000 },
  { action: 'click', selector: '.category-list button', text: 'Military' },
  { action: 'click', selector: '.building-choice', text: 'Barracks' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Barracks site placed.' },
  { action: 'click', selector: '.map-button', text: '4x' },
  { action: 'assert', selector: '.inspector .building-status', text: 'Ready', timeoutMs: 30000 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'click', selector: '.main-menu button', text: 'Settlers' },
  { action: 'click', selector: '.category-list button', text: 'Military' },
  { action: 'assert', selector: '.army-panel h2', text: 'Army' },
  { action: 'assert', selector: '[data-weapon=sword]', text: 'Sword At Barracks: 0' },
  { action: 'assert', selector: '[data-weapon=bow]', text: 'Bow At Barracks: 0' },
  empty,
  { action: 'click', selector: 'button[aria-label="Recruit a swordsman"]' },
  { action: 'click', selector: 'button[aria-label="Recruit a swordsman"]' },
  { action: 'click', selector: 'button[aria-label="Recruit a swordsman"]' },
  queued(3),
  { action: 'click', selector: 'button[aria-label="Cancel a waiting swordsman order"]' },
  { action: 'assert', selector: '[role=status]', text: 'One waiting swordsman order cancelled.' },
  queued(2),
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.', timeoutMs: 10000 },
  { action: 'click', selector: '.main-menu button', text: 'Settlers' },
  { action: 'click', selector: '.category-list button', text: 'Military' },
  queued(2),
  { action: 'assert', selector: '[data-weapon=sword]', text: 'Sword At Barracks: 0' },
  { action: 'click', selector: 'button[aria-label="Cancel a waiting swordsman order"]' },
  queued(1),
  { action: 'click', selector: 'button[aria-label="Cancel a waiting swordsman order"]' },
  empty,
  { action: 'evaluate', expression: `(() => {
    const content = document.querySelector('.hud-content').getBoundingClientRect();
    for (const button of document.querySelectorAll('.profession-list button')) {
      const box = button.getBoundingClientRect();
      if (box.left < content.left || box.right > content.right) throw new Error('Recruitment controls extend outside the HUD');
    }
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('Recruitment panel overflows the page');
    return { controlsContained: true };
  })()` },
]
const reports: unknown[] = [], media: unknown[] = []
for (const viewport of ['1440x960', '320x568']) {
  const capture = resolve(directory, `recruitment-${viewport}.png`)
  const child = Bun.spawn([
    process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', viewport, '--out', capture,
    ...steps.flatMap(step => ['--step', JSON.stringify(step)]),
  ], { stdout: 'pipe', stderr: 'pipe', timeout: 120000 })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  reports.push({ viewport, ...JSON.parse(out) })
  await writeFile(resolve(shots, 'recruitment.json'), JSON.stringify(reports, null, 2) + '\n')
  if (err) console.error(err)
  if (code !== 0) throw new Error(`Recruitment browser check failed. See ${shots}/recruitment.json`)
  const bytes = await readFile(capture)
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Recruitment acceptance did not produce a new PNG')
  media.push({ viewport,
    schemaVersion: 1,
    screenshot: { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    rasterPublication: 'withheld-pending-redistribution-evidence',
  })
}
await writeFile(resolve(shots, 'recruitment-media.json'), JSON.stringify(media, null, 2) + '\n')
console.log('Waiting recruitment orders can be reduced, saved, restored and cleared at desktop and phone sizes through the actual browser controls.')

