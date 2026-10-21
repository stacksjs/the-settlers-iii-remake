import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { contentPolicy } from '../../docs/content/policy'
import { inspectContentBundle, requireContentPublication } from '../../scripts/lib/content-provenance'
import type { ContentPolicy } from '../../scripts/lib/content-provenance'

// This public filesystem/policy seam verifies mapping and fail-closed release
// behavior. A synthetic permission fixture does not establish real game rights.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const sha = (value: string): string => new Bun.CryptoHasher('sha256').update(value).digest('hex')
interface InvalidManifestFixture {
  originalSource: { sha256: string }
  files: Array<{ path: string, inputs: string[], categories: string[] }>
  inputs: Array<{ kind: string, url?: string, revision?: string }>
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'settlers-provenance-'))
  roots.push(root)
  mkdirSync(join(root, 'bundle'))
  writeFileSync(join(root, 'converter.ts'), 'converter fixture')
  writeFileSync(join(root, 'bundle/sprite.png'), 'synthetic image bytes')
  writeFileSync(join(root, 'bundle/provenance.json'), JSON.stringify({
    schemaVersion: 1,
    originalSource: { id: 'amazons-demo', sha256: contentPolicy.originalSources[0]!.sha256 },
    inputs: [
      { id: 'graphics', kind: 'original-file', path: 'Gfx/source.dat', bytes: 5, sha256: sha('input') },
      { id: 'converter', kind: 'converter', path: 'converter.ts', bytes: 17, sha256: sha('converter fixture') },
    ],
    files: [{ path: 'sprite.png', bytes: 21, sha256: sha('synthetic image bytes'), categories: ['buildings'], inputs: ['graphics', 'converter'], selection: ['sequence 1, frame 0'] }],
  }))
  return root
}

test('private conversion verifies every file but missing redistribution evidence blocks publication', async () => {
  const root = fixture()
  const bundle = await inspectContentBundle(join(root, 'bundle'), contentPolicy)
  expect(bundle.files.length).toBe(1)
  await expect(requireContentPublication(join(root, 'bundle'), root, contentPolicy, 'web', new Date('2026-10-21T00:00:00Z'))).rejects.toThrow('No recorded redistribution evidence')
})

function syntheticGrant(root: string): ContentPolicy {
  const policy = structuredClone(contentPolicy)
  policy.originalSources[0]!.rightsStatus = 'reviewed'
  policy.originalSources[0]!.permittedChannels = ['web']
  mkdirSync(join(root, 'docs/content/permissions'), { recursive: true })
  const document = 'Synthetic permission test fixture. This is not an actual game-content grant.'
  writeFileSync(join(root, 'docs/content/permissions/fixture.txt'), document)
  policy.grants.push({
    id: 'fixture', source: 'amazons-demo', issuer: 'Synthetic fixture issuer', scope: 'Synthetic building test file only',
    permissions: ['convert', 'redistribute'], categories: ['buildings'], channels: ['web'], status: 'active',
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', reviewedBy: 'Fixture reviewer', reviewedAt: '2026-01-01T00:00:00Z',
    evidence: { path: 'docs/content/permissions/fixture.txt', sha256: sha(document) },
  })
  return policy
}

test('requires a present matching reviewed document covering conversion, redistribution, files and channel', async () => {
  const root = fixture()
  const policy = syntheticGrant(root)
  expect((await requireContentPublication(join(root, 'bundle'), root, policy, 'web', new Date('2026-10-21T00:00:00Z'))).files.length).toBe(1)
  await expect(requireContentPublication(join(root, 'bundle'), root, policy, 'ios')).rejects.toThrow('No recorded redistribution evidence')
  await expect(requireContentPublication(join(root, 'bundle'), root, policy, undefined)).rejects.toThrow('Missing or unknown publication channel')
})

test('blocks expired, revoked, future, missing and changed evidence', async () => {
  const root = fixture()
  for (const change of [
    { validUntil: '2026-10-20T00:00:00Z' }, { status: 'revoked' as const }, { validFrom: '2027-01-01T00:00:00Z' },
    { reviewedAt: '2027-01-01T00:00:00Z' }, { validUntil: 'invalid' }, { validUntil: '2027-02-30T00:00:00Z' }, { validUntil: '2027-01-01' },
  ]) {
    const policy = syntheticGrant(root)
    Object.assign(policy.grants[0]!, change)
    await expect(requireContentPublication(join(root, 'bundle'), root, policy, 'web', new Date('2026-10-21T00:00:00Z'))).rejects.toThrow('No recorded redistribution evidence')
  }
  const missing = syntheticGrant(root)
  rmSync(join(root, missing.grants[0]!.evidence.path))
  await expect(requireContentPublication(join(root, 'bundle'), root, missing, 'web')).rejects.toThrow('Missing evidence fixture')
  const changed = syntheticGrant(root)
  writeFileSync(join(root, changed.grants[0]!.evidence.path), 'Changed test document')
  await expect(requireContentPublication(join(root, 'bundle'), root, changed, 'web')).rejects.toThrow('Missing or changed evidence fixture')
})

test('rejects incomplete source identity, unsafe paths, duplicate files and unknown input mappings', async () => {
  for (const mutate of [
    (manifest: InvalidManifestFixture) => { manifest.originalSource.sha256 = '0'.repeat(64) },
    (manifest: InvalidManifestFixture) => { manifest.files[0]!.path = '../sprite.png' },
    (manifest: InvalidManifestFixture) => { manifest.files[0]!.inputs = ['unknown'] },
    (manifest: InvalidManifestFixture) => { manifest.files[0]!.inputs = ['graphics'] },
    (manifest: InvalidManifestFixture) => { manifest.files[0]!.categories = ['unknown'] },
    (manifest: InvalidManifestFixture) => { manifest.files.push(manifest.files[0]!) },
    (manifest: InvalidManifestFixture) => { manifest.inputs[0]!.kind = 'reference-source'; manifest.inputs[0]!.url = 'https://example.com/mutable'; manifest.inputs[0]!.revision = 'main' },
  ]) {
    const root = fixture(), file = join(root, 'bundle/provenance.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    mutate(manifest)
    writeFileSync(file, JSON.stringify(manifest))
    await expect(inspectContentBundle(join(root, 'bundle'), contentPolicy)).rejects.toThrow('Content publication blocked')
  }
  const root = fixture(), policy = structuredClone(contentPolicy)
  policy.inventory.pop()
  await expect(inspectContentBundle(join(root, 'bundle'), policy)).rejects.toThrow('Incomplete original media and campaign category inventory')
})

test('rejects symlinked media and changed converter identity before publication', async () => {
  const root = fixture()
  const policy = syntheticGrant(root)
  expect((await requireContentPublication(join(root, 'bundle'), root, policy, 'web')).files.length).toBe(1)
  writeFileSync(join(root, 'converter.ts'), 'changed converter')
  await expect(requireContentPublication(join(root, 'bundle'), root, policy, 'web')).rejects.toThrow('Converter source changed')
  writeFileSync(join(root, 'original.png'), 'synthetic image bytes')
  rmSync(join(root, 'bundle/sprite.png'))
  symlinkSync(join(root, 'original.png'), join(root, 'bundle/sprite.png'))
  await expect(inspectContentBundle(join(root, 'bundle'), policy)).rejects.toThrow('Converted file changed')
})

test('rejects an evidence record that omits permissions, category coverage or the requested channel', async () => {
  for (const change of [
    { permissions: ['convert'] }, { categories: ['terrain'] }, { channels: ['ios'] }, { evidence: { path: '../permission.txt', sha256: '0'.repeat(64) } },
  ]) {
    const root = fixture(), policy = syntheticGrant(root)
    Object.assign(policy.grants[0]!, change)
    await expect(requireContentPublication(join(root, 'bundle'), root, policy, 'web')).rejects.toThrow('Content publication blocked')
  }
})

test('blocks any unmapped, changed or missing bundled file', async () => {
  const root = fixture()
  writeFileSync(join(root, 'bundle/extra.wav'), 'unmapped')
  await expect(inspectContentBundle(join(root, 'bundle'), contentPolicy)).rejects.toThrow('Unmapped bundled file extra.wav')
  rmSync(join(root, 'bundle/extra.wav'))
  writeFileSync(join(root, 'bundle/sprite.png'), 'changed image bytes')
  await expect(inspectContentBundle(join(root, 'bundle'), contentPolicy)).rejects.toThrow('Converted file changed')
  rmSync(join(root, 'bundle/sprite.png'))
  await expect(inspectContentBundle(join(root, 'bundle'), contentPolicy)).rejects.toThrow('A mapped converted file is missing')
})

test('the public policy command reports inventory and fails closed without a supported publication channel', async () => {
  const root = resolve(import.meta.dir, '../..')
  const inventory = Bun.spawn([process.execPath, 'scripts/content.ts', '--inventory', '--json'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const output = JSON.parse(await new Response(inventory.stdout).text())
  expect(await inventory.exited).toBe(0)
  expect(output.inventory.length).toBe(25)
  expect(output.publicationVerified).toBe(false)
  expect(output.sourceRights[0].permittedChannels).toEqual([])
  for (const channel of ['', 'unknown']) {
    const child = Bun.spawn([process.execPath, 'scripts/content.ts', '--publication'], { cwd: root, env: { ...process.env, STACKS_PUBLICATION_CHANNEL: channel }, stdout: 'pipe', stderr: 'pipe' })
    const errors = await new Response(child.stderr).text()
    expect(await child.exited).toBe(1)
    expect(errors).toContain('Missing or unknown publication channel')
  }
})
