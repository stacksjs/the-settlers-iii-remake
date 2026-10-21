import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { png } from '@stacksjs/ts-png'
import { compareOriginalObservations, observationFixtureFingerprint, validateObservationFixture, validateObservationRun, verifyOriginalObservation } from '../../scripts/lib/original-observation'

// Synthetic protocol data, never an original-game observation.
function fixture() {
  return {
    schemaVersion: 1,
    id: 'synthetic-carrier-fixture',
    build: {
      edition: 'amazons-demo', distribution: 'Synthetic test fixture', displayedVersion: null, locale: 'en',
      executable: { path: 'game.exe', sha256: 'a'.repeat(64) },
      content: [{ path: 'Map/demo.map', sha256: 'b'.repeat(64) }],
    },
    initialState: { path: 'Save/starting.sav', sha256: 'c'.repeat(64) },
    settings: { speed: 'normal' },
    procedure: ['Load the exact saved starting state before issuing the listed inputs.'],
    commands: [{ sequence: 0, atMs: 1000, instruction: 'Select the woodcutter.' }],
    outcomeKeys: ['delivered-wood'],
  }
}

async function bundle() {
  const root = await mkdtemp(join(tmpdir(), 'settlers-observation-test-'))
  const original = join(root, 'original'), evidence = join(root, 'evidence')
  await mkdir(join(original, 'Map'), { recursive: true })
  await mkdir(join(original, 'Save'), { recursive: true })
  await mkdir(evidence)
  const write = async (base: string, path: string, bytes: string | Uint8Array) => {
    await Bun.write(join(base, path), bytes)
    return { path, sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex') }
  }
  const definition = fixture()
  definition.build.executable = await write(original, 'game.exe', 'Synthetic executable fixture, not a game')
  definition.build.content = [await write(original, 'Map/demo.map', 'Synthetic terrain fixture')]
  definition.initialState = await write(original, 'Save/starting.sav', 'Synthetic saved state fixture')
  const image = png.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) })
  const audio = Buffer.alloc(40_044)
  audio.write('RIFF'); audio.writeUInt32LE(40_036, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(8000, 28)
  audio.writeUInt16LE(1, 32); audio.writeUInt16LE(8, 34); audio.write('data', 36); audio.writeUInt32LE(40_000, 40)
  const fingerprints = observationFixtureFingerprint(definition)
  const run = {
    schemaVersion: 1,
    fixtureFingerprint: fingerprints.fixture, initialStateFingerprint: fingerprints.initialState,
    recordedAt: '2026-10-21T00:00:00.000Z', status: 'completed', durationMs: 5000,
    environment: { os: 'Synthetic host', runtime: 'Synthetic fixture runtime', width: 1, height: 1 },
    commands: definition.commands.map(command => ({ ...command })),
    outcomes: [{ key: 'delivered-wood', atMs: 4000, value: 1 }],
    captures: [
      { role: 'initial', atMs: 0, file: await write(evidence, 'initial.png', image) },
      { role: 'final', atMs: 5000, file: await write(evidence, 'final.png', image) },
      { role: 'audio', atMs: 0, file: await write(evidence, 'audio.wav', audio) },
    ],
  }
  return { root, original, evidence, definition, run }
}

describe('original observation fixtures', () => {
  test('fingerprints starting conditions independently of the ordered input procedure', () => {
    const original = observationFixtureFingerprint(fixture())
    const changedState = fixture()
    changedState.settings.speed = 'fast'
    expect(observationFixtureFingerprint(changedState).initialState).not.toBe(original.initialState)
    const changedInput = fixture()
    changedInput.commands[0]!.instruction = 'Select the sawmill.'
    expect(observationFixtureFingerprint(changedInput).initialState).toBe(original.initialState)
    expect(observationFixtureFingerprint(changedInput).fixture).not.toBe(original.fixture)
    const { id, build, ...rest } = fixture()
    const reorderedKeys = { ...rest, build, id }
    expect(observationFixtureFingerprint(reorderedKeys)).toEqual(original)
  })
  test('verifies actual local source and capture bytes without admitting original runtime behavior', async () => {
    const sample = await bundle()
    try {
      const report = await verifyOriginalObservation(sample.definition, sample.run, sample)
      expect(report.status).toBe('complete-candidate')
      expect(report.evidenceClass).toBe('candidate-original-observation')
      expect(report.originalBehaviorAdmitted).toBe(false)
      expect(report.edition).toBe('amazons-demo')
      await Bun.write(join(sample.original, 'Map/demo.map'), 'changed starting terrain')
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('Source checksum mismatch')
    }
    finally { await rm(sample.root, { recursive: true, force: true }) }
  })
  test('compares distinct candidate records without hiding changed timing or starting conditions', async () => {
    const first = await bundle(), second = await bundle()
    try {
      second.run.recordedAt = '2026-10-21T00:01:00.000Z'
      const a = await verifyOriginalObservation(first.definition, first.run, first)
      const b = await verifyOriginalObservation(second.definition, second.run, second)
      expect(compareOriginalObservations(a, b).status).toBe('matching-candidates')
      expect(compareOriginalObservations(a, b).independentExecutionVerified).toBe(false)
      expect(() => compareOriginalObservations(a, a)).toThrow('Same run')
      second.run.commands[0]!.atMs += 100
      const delayed = await verifyOriginalObservation(second.definition, second.run, second)
      expect(compareOriginalObservations(a, delayed).status).toBe('different-timings')
      expect(compareOriginalObservations(a, delayed, 100).status).toBe('matching-candidates')
      second.definition.settings.speed = 'fast'
      const fingerprints = observationFixtureFingerprint(second.definition)
      second.run.fixtureFingerprint = fingerprints.fixture; second.run.initialStateFingerprint = fingerprints.initialState
      const changed = await verifyOriginalObservation(second.definition, second.run, second)
      expect(compareOriginalObservations(a, changed).status).toBe('different-starting-conditions')
    }
    finally { await Promise.all([first.root, second.root].map(root => rm(root, { recursive: true, force: true }))) }
  })
  test('rejects traversal, unsupported schemas and reordered commands before touching local files', () => {
    const traversal = fixture()
    traversal.build.executable.path = '../game.exe'
    expect(() => validateObservationFixture(traversal)).toThrow('relative file path')
    expect(() => validateObservationFixture({ ...fixture(), schemaVersion: 2 })).toThrow('Unsupported observation fixture schema')
    const reordered = fixture()
    reordered.commands[0]!.sequence = 1
    expect(() => validateObservationFixture(reordered)).toThrow('contiguous ordered sequence')
  })
  test('keeps interrupted runs explicitly incomplete and rejects missing evidence claimed as complete', async () => {
    const sample = await bundle()
    try {
      sample.run.captures = sample.run.captures.filter(capture => capture.role === 'initial')
      expect(() => validateObservationRun({ ...sample.run, initialStateFingerprint: '0'.repeat(64) }, validateObservationFixture(sample.definition))).toThrow('Changed starting conditions')
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('Completed run lacks required evidence')
      sample.run.status = 'interrupted'; sample.run.commands = []; sample.run.outcomes = []
      const report = await verifyOriginalObservation(sample.definition, sample.run, sample)
      expect(report.status).toBe('interrupted-candidate')
      expect(report.missing).toEqual(['capture:final', 'capture:audio', 'outcome:delivered-wood', 'ordered-commands'])
    }
    finally { await rm(sample.root, { recursive: true, force: true }) }
  })
  test('rejects checksum-valid fake media and symlinks outside the selected source root', async () => {
    const sample = await bundle()
    try {
      const image = sample.run.captures.find(capture => capture.role === 'initial')!
      await Bun.write(join(sample.evidence, image.file.path), 'not a screenshot')
      image.file.sha256 = new Bun.CryptoHasher('sha256').update('not a screenshot').digest('hex')
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('PNG capture dimensions')
      const outside = join(sample.root, 'outside')
      await mkdir(outside)
      await Bun.write(join(outside, 'demo.map'), 'Synthetic terrain fixture')
      await symlink(outside, join(sample.original, 'linked'), 'junction')
      sample.definition.build.content[0]!.path = 'linked/demo.map'
      const fingerprints = observationFixtureFingerprint(sample.definition)
      sample.run.fixtureFingerprint = fingerprints.fixture; sample.run.initialStateFingerprint = fingerprints.initialState
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('escapes its selected root')
    }
    finally { await rm(sample.root, { recursive: true, force: true }) }
  })
  test('rejects truncated audio and audio that ends before the recorded run', async () => {
    const sample = await bundle()
    try {
      const capture = sample.run.captures.find(item => item.role === 'audio')!
      const path = join(sample.evidence, capture.file.path)
      const original = Buffer.from(await Bun.file(path).arrayBuffer())
      const replace = async (bytes: Buffer) => {
        await Bun.write(path, bytes)
        capture.file.sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      }
      await replace(original.subarray(0, original.length - 1))
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('complete RIFF/WAVE')
      const short = Buffer.from(original.subarray(0, 8044))
      short.writeUInt32LE(8036, 4); short.writeUInt32LE(8000, 40)
      await replace(short)
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('does not cover')
    }
    finally { await rm(sample.root, { recursive: true, force: true }) }
  })
  test('the installed decoder rejects inflated PNG data beyond the declared scanlines', async () => {
    const sample = await bundle()
    try {
      const capture = sample.run.captures.find(item => item.role === 'initial')!
      const original = Buffer.from(await Bun.file(join(sample.evidence, capture.file.path)).arrayBuffer())
      const compressed = deflateSync(Buffer.alloc(1024 * 1024))
      const chunk = Buffer.alloc(compressed.length + 12)
      chunk.writeUInt32BE(compressed.length, 0); chunk.write('IDAT', 4); compressed.copy(chunk, 8)
      chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, -4)), chunk.length - 4)
      const bytes = Buffer.concat([original.subarray(0, 33), chunk, original.subarray(-12)])
      await Bun.write(join(sample.evidence, capture.file.path), bytes)
      capture.file.sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      await expect(verifyOriginalObservation(sample.definition, sample.run, sample)).rejects.toThrow('PNG inflated data exceeds')
    }
    finally { await rm(sample.root, { recursive: true, force: true }) }
  })
  test('the CLI fingerprints the maintained fixture and returns explicit usage failures', async () => {
    const sample = await bundle()
    try {
      const path = join(sample.root, 'fixture.json')
      await Bun.write(path, JSON.stringify(sample.definition))
      const cli = join(import.meta.dir, '../../scripts/original-observations.ts')
      const child = Bun.spawn([process.execPath, cli, 'fingerprint', path], { stdout: 'pipe', stderr: 'pipe' })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(code).toBe(0)
      expect(error).toBe('')
      expect(JSON.parse(output)).toEqual(observationFixtureFingerprint(sample.definition))
      const invalid = Bun.spawn([process.execPath, cli, 'verify'], { stdout: 'pipe', stderr: 'pipe' })
      const [invalidError, invalidCode] = await Promise.all([new Response(invalid.stderr).text(), invalid.exited])
      expect(invalidCode).toBe(1)
      expect(invalidError).toContain('Usage: original-observations')
    }
    finally { await rm(sample.root, { recursive: true, force: true }) }
  }, 15_000) // Two real CLI boots include the application's normal Bun preloads.
})
