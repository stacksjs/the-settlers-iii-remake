import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveCraftBinary } from 'craft-native'

// Consume the maintained SDK resolver and public native CLI. No WebView or
// substitute runtime is involved; binary publication provenance is separate.
const requested = resolveCraftBinary()
const binary = Bun.which(requested)
if (!binary) throw new Error(`Craft native CLI is unavailable: ${requested}`)
const root = resolve(import.meta.dir, '..')
const runtime = join(root, 'storage/framework/runtime')
await mkdir(runtime, { recursive: true })
const work = await mkdtemp(join(runtime, 'native-engine-'))
try {
  const build = await Bun.build({ entrypoints: [join(root, 'tests/fixtures/native-engine-probe.ts')], outdir: work, target: 'browser', format: 'esm', minify: false })
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
  const receipt = {
    schemaVersion: 1,
    craftVersion: `${version.stdout.toString()}${version.stderr.toString()}`.trim(),
    executableSha256: Bun.SHA256.hash(await Bun.file(binary).arrayBuffer(), 'hex'),
    fixtureSha256: Bun.SHA256.hash(await Bun.file(join(root, 'tests/fixtures/native-engine-probe.ts')).arrayBuffer(), 'hex'),
    bundledEngineSha256: Bun.SHA256.hash(source, 'hex'),
    bunVersion: Bun.version,
    result: JSON.parse(expected) as unknown,
    nativeExitCode: code,
    matchedBunReference: true,
    webViewUsed: false,
    scope: 'One headless simulation, save/restore and replay fixture. Native presentation, persistent frame callbacks and Gold Edition fidelity remain unverified.',
  }
  await Bun.write(join(runtime, 'native-engine-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(JSON.stringify(receipt))
}
finally { await rm(work, { recursive: true, force: true }) }
