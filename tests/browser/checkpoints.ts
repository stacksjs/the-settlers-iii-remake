import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

// This isolated fixture bundles the application's coordinator and the installed
// public Craft browser host unchanged. Two real same-origin documents share
// native Web Locks and localStorage, without replacing either platform API.
const shots = resolve('storage/framework/runtime/shots')
await mkdir(shots, { recursive: true })
const directory = await mkdtemp(join(shots, 'checkpoint-contexts-'))
const defaults = dirname(Bun.resolveSync('@stacksjs/defaults/package.json', process.cwd()))
const driver = resolve(defaults, 'ai/skills/stacks-browse/scripts/browse.ts')
const entry = join(directory, 'fixture.ts')
await writeFile(entry, `
import { createCheckpoints } from ${JSON.stringify(resolve('resources/game/checkpoint.ts'))}
import { createBrowserPlatform } from ${JSON.stringify(Bun.resolveSync('craft-native/browser', process.cwd()))}
const host = await createBrowserPlatform({ namespace: ${JSON.stringify(`checkpoint-browser-${crypto.randomUUID()}`)} })
const checkpoints = createCheckpoints({
  get: (key, signal) => host.call('Storage', 'get', [key], signal),
  setIfAbsent: (key, value, signal) => host.call('Storage', 'setIfAbsent', [key, value], signal),
  compareAndSet: (key, expected, value, signal) => host.call('Storage', 'compareAndSet', [key, expected, value], signal),
}, 'game')
globalThis.checkpointFixture = { checkpoints, close: () => { checkpoints.dispose(); host.dispose() } }
`)
let server: ReturnType<typeof Bun.serve> | undefined
try {
  const bundle = await Bun.build({ entrypoints: [entry], target: 'browser' })
  if (!bundle.success || bundle.outputs.length !== 1) throw new Error(`Checkpoint fixture build failed: ${bundle.logs.join('\n')}`)
  const javascript = await bundle.outputs[0]!.text()
  server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/fixture.js') return new Response(javascript, { headers: { 'Content-Type': 'text/javascript' } })
      if (path === '/frame') return new Response('<!doctype html><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } })
      if (path === '/') return new Response('<!doctype html><title>Checkpoint context acceptance</title><iframe id="first" src="/frame"></iframe><iframe id="second" src="/frame"></iframe>', { headers: { 'Content-Type': 'text/html' } })
      return new Response(null, { status: path === '/favicon.ico' ? 204 : 404 })
    },
  })
  const expression = `(async () => {
    const frame = id => document.getElementById(id);
    const ready = async id => {
      const started = performance.now();
      while (!frame(id).contentWindow.checkpointFixture) {
        if (performance.now() - started > 10000) throw new Error('Real checkpoint context did not initialize');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return frame(id).contentWindow.checkpointFixture;
    };
    const a = await ready('first'), b = await ready('second');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    assert(typeof navigator.locks?.request === 'function', 'Browser must supply real Web Locks');
    assert(await a.checkpoints.load() === null && await b.checkpoints.load() === null, 'Contexts must start empty');
    const creation = await Promise.all([a.checkpoints.save('A'), b.checkpoints.save('B')]);
    assert(creation.filter(result => result.ok).length === 1, 'Competing creation must admit exactly one writer');
    assert(creation.filter(result => !result.ok && result.reason === 'superseded').length === 1, 'Losing creator must receive a conflict');
    const winner = creation[0].ok ? a : b, older = creation[0].ok ? b : a;
    const initial = creation[0].ok ? 'A' : 'B';
    assert(await older.checkpoints.load() === initial, 'Other document must see the committed checkpoint');
    const newer = await winner.checkpoints.save('newer progress');
    assert(newer.ok && newer.generation === 2, 'Current session must commit the next generation');
    const stale = await older.checkpoints.save('stale progress');
    assert(!stale.ok && stale.reason === 'superseded', 'Older loaded game state must not overwrite a later commit');
    assert(await older.checkpoints.load() === 'newer progress', 'Explicit reload must restore the winning state');
    const resumed = await older.checkpoints.save('resumed progress');
    assert(resumed.ok && resumed.generation === 3, 'Reloaded session must be able to continue');
    const nowStale = await winner.checkpoints.save('also stale');
    assert(!nowStale.ok && nowStale.reason === 'superseded', 'Previous writer must also detect its stale base');
    const loading = older.checkpoints.load();
    const saving = older.checkpoints.save('progress after reload');
    assert(await loading === 'resumed progress', 'An earlier load must finish before a later save commits');
    const afterReload = await saving;
    assert(afterReload.ok && afterReload.generation === 4, 'A save queued during reload must use its loaded session');
    const continued = await older.checkpoints.save('continued progress');
    assert(continued.ok && continued.generation === 5, 'The delayed load must not rewind the last acknowledged save base');
    a.close(); b.close();
    const closed = await a.checkpoints.save('closed');
    assert(!closed.ok && closed.reason === 'disposed', 'Closed context must refuse a new save');
    const id = creation[0].ok ? 'first' : 'second';
    await new Promise(resolve => { frame(id).onload = resolve; frame(id).contentWindow.location.reload(); });
    const restored = await ready(id);
    assert(await restored.checkpoints.load() === 'continued progress', 'New document must restore the last acknowledged commit');
    restored.close();
    return { realContexts: 2, browserWebLocks: true, competingCreation: true, staleSessionRefused: true, reloadResumes: true, loadSaveOrderPreserved: true, disposedSaveRefused: true, freshDocumentRestores: true, finalGeneration: 5 };
  })()`
  const child = Bun.spawn([process.execPath, driver, 'scenario', server.url.href,
    '--step', JSON.stringify({ action: 'evaluate', expression }),
  ], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  await writeFile(join(shots, 'checkpoints.json'), stdout)
  if (stderr) console.error(stderr)
  if (code !== 0) throw new Error('Real browser checkpoint acceptance failed. See storage/framework/runtime/shots/checkpoints.json')
  console.log('Real browser checkpoint acceptance passed: competing contexts, stale saves, explicit reload and disposal.')
}
finally {
  server?.stop(true)
  await rm(directory, { recursive: true, force: true })
}
