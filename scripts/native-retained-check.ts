import { copyFile, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// A source API integration check, separate from installed native CLI and
// publication qualification. Both paths must be selected explicitly.
const source = process.env.CRAFT_SOURCE, compiler = process.env.CRAFT_ZIG
if (!source || !compiler) throw new Error('Set CRAFT_SOURCE to the Craft checkout and CRAFT_ZIG to its pinned Zig executable.')
const root = resolve(import.meta.dir, '..'), craft = await realpath(source), zig = await realpath(compiler)
const runtime = join(root, 'storage/framework/runtime')
await mkdir(runtime, { recursive: true })
const work = await mkdtemp(join(runtime, 'native-retained-'))
async function run(command: string[], cwd: string, timeout = 180_000) {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', timeout })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode, stdout, stderr }
}
async function git(...args: string[]): Promise<string> {
  const result = await run(['git', ...args], craft, 10_000)
  if (result.exitCode !== 0) throw new Error(`Cannot inspect Craft source: ${result.stderr}`)
  return result.stdout.trim()
}
try {
  if (await git('status', '--porcelain', '--untracked-files=all', '--', 'packages/zig')) throw new Error('Craft packages/zig must be a clean source snapshot.')
  const sourceCommit = await git('rev-parse', 'HEAD')
  const packageManifest = await Bun.file(join(craft, 'packages/zig/build.zig.zon')).text()
  const pinnedZig = packageManifest.match(/\.minimum_zig_version\s*=\s*"([^"]+)"/)?.[1]
  const toolchain = await run([zig, 'version'], root, 10_000)
  if (!pinnedZig || toolchain.exitCode !== 0 || toolchain.stdout.trim() !== pinnedZig) throw new Error('The native probe requires the exact Craft source toolchain.')
  const fixture = join(root, 'tests/fixtures/native-retained-probe.ts')
  const bundle = await Bun.build({ entrypoints: [fixture], outdir: work, target: 'browser', format: 'esm', minify: false })
  if (!bundle.success || bundle.outputs.length !== 1) throw new AggregateError(bundle.logs, 'Cannot bundle the retained fixture')
  const script = await bundle.outputs[0]!.text()
  const frame = (0, eval)(script) as () => number | string
  let expected: string | undefined, bunCallbacks = 0
  for (; bunCallbacks < 10003; bunCallbacks++) {
    const value = frame()
    if (typeof value === 'string') { expected = value; bunCallbacks++; break }
  }
  if (!expected) throw new Error('The Bun retained fixture did not complete its full scenario.')
  // Independently require the original synchronous fixture's whole result.
  const baseline = await Bun.build({ entrypoints: [join(root, 'tests/fixtures/native-staffing-probe.ts')], target: 'browser', format: 'esm', minify: false })
  if (!baseline.success || baseline.outputs.length !== 1 || (0, eval)(await baseline.outputs[0]!.text()) !== expected)
    throw new Error('Retained Bun execution differs from the original 5000-tick fixture.')
  await Bun.write(join(work, 'probe.js'), script)
  for (const file of ['build.zig', 'main.zig']) await copyFile(join(root, 'tests/fixtures/native-replay-host', file), join(work, file))
  await symlink(join(craft, 'packages/zig'), join(work, 'craft'), process.platform === 'win32' ? 'junction' : 'dir')
  await Bun.write(join(work, 'build.zig.zon'), `.{
    .name = .settlers_retained_probe,
    .version = "0.0.0",
    .fingerprint = 0xb8d6273c1ed442c2,
    .minimum_zig_version = "${pinnedZig}",
    .dependencies = .{ .craft = .{ .path = "craft" } },
    .paths = .{ "build.zig", "build.zig.zon", "main.zig", "probe.js" },
}\n`)
  const build = await run([zig, 'build'], work)
  let native: Awaited<ReturnType<typeof run>> | undefined
  const executable = join(work, `zig-out/bin/settlers-retained-probe${process.platform === 'win32' ? '.exe' : ''}`)
  if (build.exitCode === 0) native = await run([executable], root, 300_000)
  if (sourceCommit !== await git('rev-parse', 'HEAD') || await git('status', '--porcelain', '--untracked-files=all', '--', 'packages/zig'))
    throw new Error('Craft source changed during qualification; repeat with an isolated clean snapshot.')
  const applicationHead = await run(['git', 'rev-parse', 'HEAD'], root, 10_000)
  const applicationStatus = await run(['git', 'status', '--porcelain'], root, 10_000)
  const applicationDiff = await run(['git', 'diff', 'HEAD', '--binary'], root, 10_000)
  if ([applicationHead, applicationStatus, applicationDiff].some(result => result.exitCode !== 0)) throw new Error('Cannot retain application source identity.')
  const hostFiles = ['build.zig', 'main.zig']
  const hostSources = Object.fromEntries(await Promise.all(hostFiles.map(async file => [file, Bun.SHA256.hash(await Bun.file(join(work, file)).arrayBuffer(), 'hex')])))
  const receipt = {
    schemaVersion: 1, recordedAt: new Date().toISOString(),
    applicationHead: applicationHead.stdout.trim(), applicationDirty: applicationStatus.stdout.trim() !== '',
    applicationTrackedDiffSha256: Bun.SHA256.hash(applicationDiff.stdout, 'hex'),
    checkScriptSha256: Bun.SHA256.hash(await Bun.file(import.meta.path).arrayBuffer(), 'hex'),
    hostSources, hostManifestSha256: Bun.SHA256.hash(await Bun.file(join(work, 'build.zig.zon')).arrayBuffer(), 'hex'),
    nativeExecutableSha256: build.exitCode === 0 ? Bun.SHA256.hash(await Bun.file(executable).arrayBuffer(), 'hex') : null,
    craftSourceCommit: sourceCommit, craftSourceTree: await git('rev-parse', 'HEAD:packages/zig'),
    zigVersion: pinnedZig, zigExecutableSha256: Bun.SHA256.hash(await Bun.file(zig).arrayBuffer(), 'hex'),
    bunVersion: Bun.version, fixtureSha256: Bun.SHA256.hash(await Bun.file(fixture).arrayBuffer(), 'hex'),
    bundleSha256: Bun.SHA256.hash(script, 'hex'),
    bundleBytes: new TextEncoder().encode(script).byteLength,
    runtimeOptions: 'Craft PersistentRuntime defaults, unchanged',
    bunCallbacks, expected: JSON.parse(expected) as unknown, build, native,
    matchedBunReference: native?.exitCode === 0 && native.stdout === '' && native.stderr.trim() === JSON.stringify({ callbacks: bunCallbacks, result: JSON.parse(expected) }),
    interpreterGuardChanged: false, tickWindowShortened: false, webViewUsed: false,
    scope: 'Headless source API consumer of Craft PersistentRuntime. No published artifact, display-linked callback, graphics, native HUD or Gold fidelity qualification.',
  }
  await Bun.write(join(runtime, 'native-retained-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(JSON.stringify(receipt))
  if (!receipt.matchedBunReference) throw new Error('Retained native execution failed; see storage/framework/runtime/native-retained-receipt.json.')
}
finally { await rm(work, { recursive: true, force: true }) }
