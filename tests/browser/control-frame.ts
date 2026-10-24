import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const url = Bun.argv[2] ?? 'http://127.0.0.1:3450/'
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(resolve(shots, 'control-frame-'))
const media: unknown[] = [], reports: unknown[] = []

for (const [width, height, profile] of [[1280, 720, 480], [1280, 850, 600], [1440, 960, 768], [320, 568, 768]] as const) {
  const expression = `(async () => {
    const page = document.querySelector('.playfield');
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const panel = rect('.original-panel'), overview = rect('.overview');
    const primary = rect('.main-menu'), secondary = rect('.category-list'), content = rect('.hud-content');
    if (page.dataset.hudProfile !== '${profile}') throw new Error('Wrong reference resolution profile');
    const tolerance = 1;
    if (Math.abs(overview.bottom - panel.top) > tolerance) throw new Error('Original minimap and panel are separated');
    if (primary.top < panel.top || primary.bottom > secondary.top + tolerance || secondary.bottom > content.top + tolerance) throw new Error('Original control openings overlap');
    if (content.left < panel.left || content.right > panel.right + tolerance || content.bottom > panel.bottom) throw new Error('Content escapes the original frame');
    if (rect('.production-table').right > content.right + tolerance) throw new Error('Production figures are clipped by the original content opening');
    const left = rect('.minimap-frame-left'), right = rect('.minimap-frame-right');
    if (Math.abs(left.right - right.left) > tolerance || Math.abs(right.right - overview.right) > tolerance) throw new Error('Original minimap frame edges are separated');
    if (${width} > 760) {
      const world = document.querySelector('.island-map');
      if (document.elementFromPoint(overview.left + 2, overview.top + overview.height / 2) === world) throw new Error('Clicking the original stone frame reaches the world beneath it');
      const map = rect('.overview-map');
      if (document.elementFromPoint(map.left + map.width / 2, map.top + map.height / 2) !== document.querySelector('.overview-map')) throw new Error('Original frame blocks minimap input');
      if (document.elementFromPoint(overview.right - 2, overview.bottom - 2) !== world) throw new Error('Transparent outside corner blocks world input');
    }
    const images = ['panel', 'panel-right', 'minimap', 'minimap-right'];
    await Promise.all(images.map(async key => {
      const image = new Image(); image.src = '/assets/settlers-original/ui/' + key + '-${profile}.png'; await image.decode();
      const element = key === 'panel' || key === 'panel-right' ? document.querySelector('.original-panel') : document.querySelector('.minimap-frame-' + (key === 'minimap' ? 'left' : 'right'));
      const style = getComputedStyle(element, key === 'panel-right' ? '::after' : null);
      if (!style.backgroundImage.includes(key + '-${profile}.png')) throw new Error('Original frame art not delivered to its visible element');
    }));
    const scroll = document.querySelector('.hud-content');
    scroll.scrollTop = scroll.scrollHeight;
    if (scroll.scrollTop === 0 || Math.abs(rect('.main-menu').top - primary.top) > tolerance) throw new Error('Panel scrolling moved the fixed original controls');
    scroll.scrollTop = 0;
    if (document.documentElement.scrollWidth > ${width}) throw new Error('Original frame overflows the viewport');
    return { profile: ${profile}, viewport: '${width}x${height}', panel: { width: panel.width, height: panel.height }, openingsContained: true, fixedControlsDuringScroll: true };
  })()`
  const capture = resolve(directory, `${width}x${height}.png`)
  const child = Bun.spawn([
    process.execPath, driver, 'scenario', url, '--viewport', `${width}x${height}`, '--out', capture,
    '--step', JSON.stringify({ action: 'wait', ms: 1500 }),
    '--step', JSON.stringify({ action: 'click', selector: '.main-menu button', text: 'Settlers' }),
    '--step', JSON.stringify({ action: 'click', selector: '.category-list button', text: 'Production statistics' }),
    '--step', JSON.stringify({ action: 'assert', selector: '.production-statistics h2', text: 'Production statistics' }),
    '--step', JSON.stringify({ action: 'evaluate', expression }),
    '--step', JSON.stringify({ action: 'focus', selector: '.hud-content' }),
    '--step', JSON.stringify({ action: 'press', key: 'ArrowDown' }),
    '--step', JSON.stringify({ action: 'press', key: 'ArrowDown' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: `(async () => {
      const content = document.querySelector('.hud-content'), start = performance.now();
      while (content.scrollTop === 0 && performance.now() - start < 1000) await new Promise(resolve => requestAnimationFrame(resolve));
      if (document.activeElement !== content || content.scrollTop === 0) throw new Error('Focused production figures cannot be scrolled with the keyboard');
      return { keyboardScrolled: true, scrollTop: content.scrollTop };
    })()` }),
  ], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  let report: unknown = { stdout, stderr }
  try { report = JSON.parse(stdout) }
  catch { /* Preserve a failing driver's original output. */ }
  reports.push({ viewport: `${width}x${height}`, code, report })
  let screenshot: { sha256: string, bytes: number, width: number, height: number } | null = null
  try {
    const bytes = await readFile(capture)
    if (bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.toString('ascii', 12, 16) === 'IHDR')
      screenshot = { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  media.push({ viewport: `${width}x${height}`, browserExitCode: code, screenshot })
  await writeFile(resolve(shots, 'control-frame.json'), `${JSON.stringify(reports, null, 2)}\n`)
  await writeFile(resolve(shots, 'control-frame-media.json'), `${JSON.stringify({ schemaVersion: 1, rasterPublication: 'withheld-pending-redistribution-evidence', captures: media }, null, 2)}\n`)
  if (code !== 0 || !screenshot || screenshot.width !== width || screenshot.height !== height) throw new Error(`Original control frame failed at ${width}x${height}. See ${shots}/control-frame.json`)
}
console.log('Original control frames verified: three reference profiles, phone layout, delivered PNGs and fixed controls during scrolling.')
