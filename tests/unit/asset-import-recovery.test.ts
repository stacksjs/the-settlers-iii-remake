import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { contentPolicy } from '../../docs/content/policy'
import { inspectContentBundle } from '../../scripts/lib/content-provenance'
import { importContentBundle } from '../../scripts/lib/content-import'

// The actual importer CLI and filesystem are the seam. Synthetic content proves
// failure recovery, not original media, redistribution permission or Gold rules.
const project = resolve(import.meta.dir, '../..')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const sha = (bytes: string | Uint8Array): string => Bun.SHA256.hash(bytes, 'hex')

function fixture(): { root: string, output: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'settlers-import-recovery-')))
  roots.push(root)
  for (const path of ['scripts', 'resources/game', 'docs/content']) cpSync(join(project, path), join(root, path), { recursive: true })
  for (const path of ['package.json', 'bun.lock']) cpSync(join(project, path), join(root, path))
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'dir')
  const output = join(root, 'public/assets/settlers-original')
  mkdirSync(output, { recursive: true })
  writeBundle(output, 'retained.txt', 'retained complete fixture bundle')
  return { root, output }
}

function writeBundle(directory: string, path: string, bytes: string): void {
  writeFileSync(join(directory, path), bytes)
  writeFileSync(join(directory, 'provenance.json'), JSON.stringify({
    schemaVersion: 1,
    originalSource: { id: 'amazons-demo', sha256: contentPolicy.originalSources[0]!.sha256 },
    inputs: [
      { id: 'original', kind: 'original-file', path: 'Gfx/fixture.dat', bytes: 5, sha256: sha('input') },
      { id: 'converter', kind: 'converter', path: 'scripts/import-assets.ts', bytes: 9, sha256: sha('converter') },
    ],
    files: [{ path, bytes: bytes.length, sha256: sha(bytes), categories: ['buildings'], inputs: ['original', 'converter'], selection: ['synthetic recovery fixture'] }],
  }))
}

function importOptions(root: string, output: string) {
  return { directory: output, sourceDirectory: join(root, 'storage/reference/demo'), temporaryRoot: join(root, 'storage/reference'), policy: contentPolicy }
}

function snapshot(directory: string): Record<string, string> {
  if (!existsSync(directory)) return {}
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? Object.entries(snapshot(join(directory, entry.name))).map(([path, hash]) => [`${entry.name}/${path}`, hash])
    : [[entry.name, sha(readFileSync(join(directory, entry.name)))]]))
}

test('a rejected cached original archive preserves the complete installed bundle', async () => {
  const { root, output } = fixture()
  await inspectContentBundle(output, contentPolicy)
  const before = snapshot(output)
  mkdirSync(join(root, 'storage/reference'), { recursive: true })
  writeFileSync(join(root, 'storage/reference/s3a_demo_us.exe'), 'corrupt cached archive fixture')
  const child = Bun.spawn([process.execPath, '--no-env-file', 'scripts/import-assets.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(code, stdout + stderr).not.toBe(0)
  expect(stderr).toContain('Demo checksum does not match the pinned original')
  expect(snapshot(output)).toEqual(before)
  expect((await inspectContentBundle(output, contentPolicy)).files[0]!.path).toBe('retained.txt')
}, 20_000)

test('a failed conversion preserves its original error and the complete installed bundle', async () => {
  const { root, output } = fixture(), options = importOptions(root, output), before = snapshot(output)
  const failure = new Error('A late decoder rejected its input after writing output')
  await expect(importContentBundle(options, async workspace => {
    writeFileSync(join(workspace.output, 'partial.png'), 'partial conversion fixture')
    throw failure
  })).rejects.toBe(failure)
  expect(snapshot(output)).toEqual(before)
  expect(readdirSync(options.temporaryRoot)).toEqual([])
  expect((await inspectContentBundle(output, contentPolicy)).files[0]!.path).toBe('retained.txt')
})

test('an invalid completed conversion is rejected before either destination is published', async () => {
  const { root, output } = fixture(), options = importOptions(root, output), before = snapshot(output)
  await expect(importContentBundle(options, async workspace => {
    writeBundle(workspace.output, 'new.txt', 'new complete fixture bundle')
    writeFileSync(join(workspace.output, 'new.txt'), 'changed after manifest creation')
  })).rejects.toThrow('Converted file changed')
  expect(snapshot(output)).toEqual(before)
  expect(existsSync(options.sourceDirectory)).toBe(false)
  expect(readdirSync(options.temporaryRoot)).toEqual([])
})

test('successful validated import installs both complete destinations and removes stale public files', async () => {
  const { root, output } = fixture(), options = importOptions(root, output)
  await importContentBundle(options, async workspace => {
    mkdirSync(join(workspace.source, 'Gfx'))
    writeFileSync(join(workspace.source, 'Gfx/fixture.dat'), 'input')
    writeBundle(workspace.output, 'new.txt', 'new complete fixture bundle')
  })
  expect((await inspectContentBundle(output, contentPolicy)).files[0]!.path).toBe('new.txt')
  expect(readFileSync(join(output, 'new.txt'), 'utf8')).toBe('new complete fixture bundle')
  expect(existsSync(join(output, 'retained.txt'))).toBe(false)
  expect(readFileSync(join(options.sourceDirectory, 'Gfx/fixture.dat'), 'utf8')).toBe('input')
  expect(readdirSync(options.temporaryRoot)).toEqual(['demo'])
})

test('native rollback recovery preserves the private candidate and original recovery metadata', async () => {
  const { StorageRenameRecoveryError } = await import('@stacksjs/storage/move')
  const { root, output } = fixture(), options = importOptions(root, output)
  const installation = Object.assign(new Error('Injected public bundle installation EIO'), { code: 'EIO' })
  const restoration = Object.assign(new Error('Injected public bundle restoration EACCES'), { code: 'EACCES' })
  const native = fs.renameSync
  let candidate = ''
  const fault = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from) === candidate && String(to) === output && !existsSync(output)) throw installation
    if (String(from).endsWith('/previous') && String(to) === output) throw restoration
    native(from, to)
  })
  try {
    let failure: unknown
    try {
      await importContentBundle(options, async workspace => {
        candidate = workspace.output
        writeBundle(workspace.output, 'new.txt', 'new complete fixture bundle')
      })
    }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(StorageRenameRecoveryError)
    const recovery = failure as InstanceType<typeof StorageRenameRecoveryError>
    expect(recovery).toMatchObject({ phase: 'rollback', cause: installation, recoveryError: restoration, installed: false })
    expect(readFileSync(join(candidate, 'new.txt'), 'utf8')).toBe('new complete fixture bundle')
    expect(readFileSync(join(recovery.backup!, 'retained.txt'), 'utf8')).toBe('retained complete fixture bundle')
    expect(existsSync(dirname(candidate))).toBe(true)
    expect(existsSync(recovery.lock)).toBe(true)
  }
  finally { fault.mockRestore() }
})
