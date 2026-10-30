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
const directory = await mkdtemp(resolve(shots, 'control-frame-'))
const media: unknown[] = [], reports: unknown[] = []

// Measure after the maintained STX render has exposed the newly selected node.
// This observes real frames and layout; it never changes focus or scroll state.
const inspection = (name: string, result: string) => `(async () => {
  const visible = () => {
    const panel=document.querySelector('.hud-content').getBoundingClientRect();
    const heading=document.querySelector('.inspector h2'), status=document.querySelector('.inspector .building-status');
    return heading?.textContent===${JSON.stringify(name)} && [heading,status].every(el=>{const r=el?.getBoundingClientRect();return r && r.top>=panel.top && r.bottom<=panel.bottom;});
  };
  const start=performance.now();
  while (!visible() && performance.now()-start<1000) await new Promise(resolve=>requestAnimationFrame(resolve));
  if (!visible()) throw new Error('Selected building name or status is outside the control opening: '+${JSON.stringify(name)});
  if (document.activeElement!==document.querySelector('.island-map')) throw new Error('Inspection stole map keyboard focus');
  return { ${result}:true, mapFocusPreserved:true };
})()`

for (const [width, height, profile] of [[812, 375, 480], [1024, 600, 480], [1280, 720, 480], [1280, 850, 600], [1440, 960, 768], [320, 568, 768]] as const) {
  const expression = `(async () => {
    const page = document.querySelector('.playfield');
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const panel = rect('.original-panel'), overview = rect('.overview');
    const primary = rect('.main-menu'), secondary = rect('.category-list'), content = rect('.hud-content');
    if (page.dataset.hudProfile !== '${profile}') throw new Error('Wrong reference resolution profile');
    const tolerance = 1;
    if (${width} > 760) {
      const world = rect('.map-region'), playfield = page.getBoundingClientRect();
      if (world.top < 0 || world.bottom > innerHeight + tolerance || playfield.bottom > innerHeight + tolerance) throw new Error('The world extends below the visible viewport');
      if (Math.abs(world.bottom - panel.bottom) > tolerance) throw new Error('World and original control frame use different available heights');
      if (document.documentElement.scrollHeight > innerHeight + tolerance) throw new Error('The desktop game requires page scrolling');
      if (${height} < 650 && rect('.map-caption').bottom > rect('.advisor').top) throw new Error('Map caption and settlement dispatch overlap on the short viewport');
    }
    if (Math.abs(overview.bottom - panel.top) > tolerance) throw new Error('Original minimap and panel are separated');
    if (primary.top < panel.top || primary.bottom > secondary.top + tolerance || secondary.bottom > content.top + tolerance) throw new Error('Original control openings overlap');
    if (content.left < panel.left || content.right > panel.right + tolerance || content.bottom > panel.bottom) throw new Error('Content escapes the original frame');
    if (rect('.production-table').right > content.right + tolerance) throw new Error('Production figures are clipped by the original content opening');
    if ([...document.querySelectorAll('.production-table tbody th,.production-table tbody td')].some(cell => cell.getBoundingClientRect().right > content.right + tolerance)) throw new Error('A production figure escapes the visible panel');
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
    if (scroll.scrollWidth > scroll.clientWidth + tolerance) throw new Error('Settlement details require horizontal scrolling to read their labels');
    scroll.scrollTop = scroll.scrollHeight;
    if (scroll.scrollTop === 0 || Math.abs(rect('.main-menu').top - primary.top) > tolerance) throw new Error('Panel scrolling moved the fixed original controls');
    scroll.scrollTop = 0;
    if (document.documentElement.scrollWidth > ${width}) throw new Error('Original frame overflows the viewport');
    const world = rect('.map-region');
    return { profile: ${profile}, viewport: '${width}x${height}', panel: { width: panel.width, height: panel.height }, world: { top: world.top, bottom: world.bottom, height: world.height }, pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, captionBottom: rect('.map-caption').bottom, dispatchTop: rect('.advisor').top, productionWidth: rect('.production-table').width, contentWidth: content.width, openingsContained: true, fixedControlsDuringScroll: true };
  })()`
  const capture = resolve(directory, `${width}x${height}.png`)
  const child = Bun.spawn([
    process.execPath, driver, 'scenario', url, ...await signInArgs(base), '--viewport', `${width}x${height}`, '--out', capture,
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
    '--step', JSON.stringify({ action: 'click', selector: 'header button', text: 'Guide' }),
    '--step', JSON.stringify({ action: 'assert', selector: '.guide-panel h2', text: 'Every good is carried.' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: `(() => {
      const panel = document.querySelector('.guide-panel'), box = panel.getBoundingClientRect();
      const map = document.querySelector('.map-region').getBoundingClientRect();
      if (box.top < map.top || box.bottom > map.bottom || box.left < map.left || box.right > map.right) throw new Error('Gameplay guide extends outside the map and clips its controls');
      if (!['auto', 'scroll'].includes(getComputedStyle(panel).overflowY)) throw new Error('Gameplay guide has no scroll container');
      return { guideContained: true, guideHeight: box.height, mapHeight: map.height };
    })()` }),
    '--step', JSON.stringify({ action: 'focus', selector: '.guide-panel' }),
    '--step', JSON.stringify({ action: 'press', key: 'End' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: `(async () => {
      const panel = document.querySelector('.guide-panel'), start = performance.now();
      const needsScroll = panel.scrollHeight > panel.clientHeight;
      while (needsScroll && panel.scrollTop + panel.clientHeight < panel.scrollHeight - 2 && performance.now() - start < 1000) await new Promise(resolve => requestAnimationFrame(resolve));
      const button = panel.querySelector('button'), box = panel.getBoundingClientRect(), close = button.getBoundingClientRect();
      if (document.activeElement !== panel || close.top < box.top || close.bottom > box.bottom) throw new Error('Keyboard guide scrolling did not reveal its close button');
      if (needsScroll && panel.scrollTop === 0) throw new Error('Gameplay guide did not scroll with the keyboard');
      const x = close.left + close.width / 2, y = close.top + close.height / 2;
      // On a phone, the whole game can scroll vertically. Within the current
      // viewport, also prove the visible button receives pointer input.
      if (y < innerHeight && document.elementFromPoint(x, y) !== button) throw new Error('Gameplay guide close button is covered');
      return { keyboardGuideScrolled: true, scrollTop: panel.scrollTop, closeButtonContained: true };
    })()` }),
    '--step', JSON.stringify({ action: 'click', selector: '.guide-panel button', text: 'Back to the settlement' }),
    '--step', JSON.stringify({ action: 'assert', selector: '.guide-panel', absent: true }),
    '--step', JSON.stringify({ action: 'assert', selector: 'header button', text: 'Guide', focused: true }),
    '--step', JSON.stringify({ action: 'click', selector: '.main-menu button', text: 'Buildings' }),
    '--step', JSON.stringify({ action: 'click', selector: '.category-list button', text: 'Resources' }),
    '--step', JSON.stringify({ action: 'click', selector: '.building-choice', text: "Woodcutter's hut" }),
    '--step', JSON.stringify({ action: 'press', key: 'Enter' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: inspection("Woodcutter's hut", 'selectedSiteIdentityVisible') }),
    '--step', JSON.stringify({ action: 'focus', selector: '.hud-content' }),
    '--step', JSON.stringify({ action: 'press', key: 'End' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: `(async () => {
      const content=document.querySelector('.hud-content'), start=performance.now();
      while (content.scrollTop+content.clientHeight<content.scrollHeight-2 && performance.now()-start<1000) await new Promise(resolve=>requestAnimationFrame(resolve));
      const top=content.scrollTop;
      await new Promise(resolve=>setTimeout(resolve,500));
      if (top===0 || Math.abs(content.scrollTop-top)>1) throw new Error('Repeated simulation updates reset deliberate inspection scrolling');
      return { sameBuildingScrollPreserved:true, scrollTop:top };
    })()` }),
    '--step', JSON.stringify({ action: 'click', selector: '.control-center button', text: 'Inspect' }),
    '--step', JSON.stringify({ action: 'focus', selector: '.island-map' }),
    '--step', JSON.stringify({ action: 'press', key: 'h' }),
    '--step', JSON.stringify({ action: 'click', selector: '.island-map' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: inspection('Castle', 'differentBuildingIdentityVisible') }),
    '--step', JSON.stringify({ action: 'press', key: 'Escape' }),
    '--step', JSON.stringify({ action: 'assert', selector: '.inspector', absent: true }),
    '--step', JSON.stringify({ action: 'press', key: 'Enter' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: inspection('Castle', 'clearedAndReselectedIdentityVisible') }),
    '--step', JSON.stringify({ action: 'click', selector: 'header button', text: 'Save' }),
    '--step', JSON.stringify({ action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.', timeoutMs: 2000 }),
    '--step', JSON.stringify({ action: 'click', selector: 'header button', text: 'Load' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: `(async () => {
      const start=performance.now();
      while (document.querySelector('[role=status]').textContent!=='Saved settlement restored.' && performance.now()-start<2000) await new Promise(resolve=>requestAnimationFrame(resolve));
      if (document.querySelector('[role=status]').textContent!=='Saved settlement restored.' || document.querySelector('.inspector')) throw new Error('Session replacement did not clear the selected inspector');
      return { replacementClearsInspection:true };
    })()` }),
    '--step', JSON.stringify({ action: 'focus', selector: '.island-map' }),
    '--step', JSON.stringify({ action: 'press', key: 'Enter' }),
    '--step', JSON.stringify({ action: 'evaluate', expression: inspection('Castle', 'replacementIdentityVisible') }),
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
console.log('Original control frames verified: three reference profiles, short landscape and phone layouts, delivered PNGs and fixed controls during scrolling.')
