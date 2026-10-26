import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveCraftBinary } from 'craft-native'

if (process.argv.slice(2).some(arg => arg !== '--browser' && arg !== '--staffing')) throw new Error('Usage: bun scripts/native-engine-check.ts [--browser] [--staffing]')

// Consume the maintained SDK resolver and public native CLI. No WebView or
// substitute runtime is involved; binary publication provenance is separate.
const requested = resolveCraftBinary()
const binary = Bun.which(requested)
if (!binary) throw new Error(`Craft native CLI is unavailable: ${requested}`)
const root = resolve(import.meta.dir, '..')
const staffing = process.argv.includes('--staffing')
const fixture = staffing ? 'native-staffing-probe.ts' : 'native-engine-probe.ts'
const runtime = join(root, 'storage/framework/runtime')
await mkdir(runtime, { recursive: true })
const work = await mkdtemp(join(runtime, 'native-engine-'))
try {
  const build = await Bun.build({ entrypoints: [join(root, 'tests/fixtures', fixture)], outdir: work, target: 'browser', format: 'esm', minify: false })
  if (!build.success) throw new AggregateError(build.logs, 'Cannot bundle the shared engine fixture')
  if (build.outputs.length !== 1) throw new Error('The shared engine fixture must produce one self-contained script')
  const artifact = build.outputs[0]!, source = await artifact.text()
  const expected: unknown = (0, eval)(source)
  if (typeof expected !== 'string') throw new Error('The shared engine fixture did not return a reference result')
  const child = Bun.spawn([binary, '--eval-file', artifact.path], { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  // Craft's eval CLI prints its completion value to stderr. Require the whole
  // result, so extra diagnostics or partial execution cannot pass as parity.
  if (code !== 0 || stdout !== '' || stderr.trim() !== expected)
    throw new Error(`Shared engine execution differs in Craft (exit ${code}): ${stdout}${stderr}`)
  const version = Bun.spawnSync([binary, '--version'], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
  if (version.exitCode !== 0) throw new Error('Cannot record the Craft native CLI version')
  let browser: { result: unknown, consoleErrors: unknown[], failedRequests: unknown[], driverSha256: string } | undefined
  if (process.argv.includes('--browser')) {
    const driver = join(Bun.resolveSync('@stacksjs/defaults/package.json', root), '../ai/skills/stacks-browse/scripts/browse.ts')
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/probe.js') return new Response(source, { headers: { 'Content-Type': 'application/javascript' } })
        if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 })
        if (url.pathname !== '/') return new Response('Not found', { status: 404 })
        return new Response('<!doctype html><title>Shared engine fixture</title><main>Shared engine runtime comparison</main>', { headers: { 'Content-Type': 'text/html' } })
      },
    })
    try {
      const step = {
        action: 'evaluate',
        expression: `(async () => { const response = await fetch('/probe.js'); if (!response.ok) throw new Error('Fixture fetch failed'); const result = (0, eval)(await response.text()); if (result !== ${JSON.stringify(expected)}) throw new Error('Browser simulation differs from native execution'); return JSON.parse(result); })()`,
      }
      const process = Bun.spawn([Bun.argv[0]!, driver, 'scenario', server.url.href, '--step', JSON.stringify(step)], { cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
      const [exitCode, output, errors] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()])
      if (exitCode !== 0) throw new Error(`Browser engine check failed (exit ${exitCode}): ${output}${errors}`)
      const report = JSON.parse(output) as { steps?: { ok?: boolean, value?: unknown }[], consoleErrors?: unknown[], failedRequests?: unknown[] }
      if (report.steps?.[0]?.ok !== true || JSON.stringify(report.steps[0].value) !== expected || report.consoleErrors?.length !== 0 || report.failedRequests?.length !== 0)
        throw new Error('Browser did not verify the complete shared engine result without errors')
      browser = { result: report.steps[0].value, consoleErrors: report.consoleErrors, failedRequests: report.failedRequests, driverSha256: Bun.SHA256.hash(await Bun.file(driver).arrayBuffer(), 'hex') }
    }
    finally { await server.stop(true) }
  }
  const receipt = {
    schemaVersion: 1,
    craftVersion: `${version.stdout.toString()}${version.stderr.toString()}`.trim(),
    executableSha256: Bun.SHA256.hash(await Bun.file(binary).arrayBuffer(), 'hex'),
    fixtureSha256: Bun.SHA256.hash(await Bun.file(join(root, 'tests/fixtures', fixture)).arrayBuffer(), 'hex'),
    bundledEngineSha256: Bun.SHA256.hash(source, 'hex'),
    bunVersion: Bun.version,
    result: JSON.parse(expected) as unknown,
    nativeExitCode: code,
    matchedBunReference: true,
    webViewUsed: false,
    browser,
    scope: staffing
      ? 'Headless 5000-tick reachable staffing scenario with save/restore and replay. Native presentation, persistent frame callbacks and Gold Edition fidelity remain unverified.'
      : 'Headless baseline, construction-tool recovery and ground-pile ownership scenarios with save/restore and replay. Native presentation, persistent frame callbacks and Gold Edition fidelity remain unverified.',
  }
  await Bun.write(join(runtime, staffing ? 'native-staffing-receipt.json' : 'native-engine-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(JSON.stringify(receipt))
}
finally { await rm(work, { recursive: true, force: true }) }
