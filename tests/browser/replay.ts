import { closeSharedBrowsers, launch, navigate } from '@stacksjs/testing/browser'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

// Run the complete retained construction/save/replay fixture across browser
// event-loop turns, without injecting simulation state or changing its rules.
const root = resolve(import.meta.dir, '../..')
const build = await Bun.build({ entrypoints: [resolve(root, 'tests/fixtures/native-retained-probe.ts')], target: 'browser', format: 'esm', minify: false })
if (!build.success || build.outputs.length !== 1) throw new AggregateError(build.logs, 'Cannot bundle the retained replay fixture')
const source = await build.outputs[0]!.text()
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(source, { headers: { 'Content-Type': 'application/javascript' } })
  if (path === '/favicon.ico') return new Response(null, { status: 204 })
  if (path !== '/') return new Response('Not found', { status: 404 })
  return new Response('<!doctype html><title>Incremental replay verification</title>', { headers: { 'Content-Type': 'text/html' } })
} })
try {
  const { cdp, close } = await launch()
  try {
    const failedRequests: { url: string, status: number }[] = []
    cdp.on('Network.responseReceived', ({ response }: { response: { url: string, status: number } }) => { if (response.status >= 400) failedRequests.push({ url: response.url, status: response.status }) })
    if (!await navigate(cdp, server.url.href)) throw new Error('The replay fixture page did not settle')
    const proof = await cdp.evaluate<{ callbacks: number, turns: number, result: unknown }>(`(async () => {
      const response = await fetch('/fixture.js'); if (!response.ok) throw new Error('Fixture fetch failed');
      const frame = (0, eval)(await response.text()); let callbacks = 0, turns = 0;
      while (callbacks < 10003) {
        for (let i = 0; i < 32 && callbacks < 10003; i++) {
          const value = frame(); callbacks++;
          if (typeof value === 'string') return { callbacks, turns, result: JSON.parse(value) };
        }
        await new Promise(resolve => setTimeout(resolve, 0)); turns++;
      }
      throw new Error('Replay scenario did not finish');
    })()`)
    const expected = { tick: 5000, checksum: 'b413c661', restoredChecksum: 'b413c661', replay: { ok: true, ticks: 5000, checksum: 'b413c661' }, storagePhase: 'active', createdUnchanged: true }
    if (proof.callbacks !== 10002 || proof.turns !== 312 || JSON.stringify(proof.result) !== JSON.stringify(expected)) throw new Error(`Browser replay differs: ${JSON.stringify(proof)}`)
    const report = { schemaVersion: 1, browser: await cdp.send('Browser.getVersion'), bundleSha256: Bun.SHA256.hash(source, 'hex'), ...proof, consoleErrors: cdp.errors, failedRequests }
    const runtime = resolve(root, 'storage/framework/runtime/shots')
    await mkdir(runtime, { recursive: true })
    await Bun.write(resolve(runtime, 'replay.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report))
    if (cdp.errors.length || failedRequests.length) throw new Error('Browser replay recorded console or request errors.')
  }
  finally { await close() }
}
finally { await server.stop(true); await closeSharedBrowsers() }
