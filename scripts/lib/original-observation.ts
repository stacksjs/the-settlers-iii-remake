import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { png } from '@stacksjs/ts-png'

export interface ObservationFile { path: string, sha256: string }
export interface OriginalObservationFixture {
  schemaVersion: 1
  id: string
  build: {
    edition: 'base' | 'mission-cd' | 'amazons' | 'gold' | 'amazons-demo'
    distribution: string
    displayedVersion: string | null
    locale: string
    executable: ObservationFile
    content: ObservationFile[]
  }
  initialState: ObservationFile
  settings: Record<string, string | number | boolean>
  procedure: string[]
  commands: { sequence: number, atMs: number, instruction: string }[]
  outcomeKeys: string[]
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object: ${label}`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown field: ${label}.${key}`)
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw new Error(`Invalid text: ${label}`)
  return value
}

function list(value: unknown, label: string, maximum = 4096): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Invalid list: ${label}`)
  return value
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 86_400_000) throw new Error(`Invalid integer: ${label}`)
  return value
}

function file(value: unknown, label: string): ObservationFile {
  const entry = object(value, label)
  keys(entry, ['path', 'sha256'], label)
  const path = text(entry.path, `${label}.path`)
  if (path.length > 512 || path.includes('\\') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error(`Expected portable relative file path: ${label}`)
  const sha256 = text(entry.sha256, `${label}.sha256`)
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid SHA-256: ${label}`)
  return { path, sha256 }
}

export function validateObservationFixture(value: unknown): OriginalObservationFixture {
  const fixture = object(value, 'fixture')
  keys(fixture, ['schemaVersion', 'id', 'build', 'initialState', 'settings', 'procedure', 'commands', 'outcomeKeys'], 'fixture')
  if (fixture.schemaVersion !== 1) throw new Error('Unsupported observation fixture schema')
  const id = text(fixture.id, 'fixture.id')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid fixture identifier')
  const build = object(fixture.build, 'build')
  keys(build, ['edition', 'distribution', 'displayedVersion', 'locale', 'executable', 'content'], 'build')
  const edition = text(build.edition, 'build.edition') as OriginalObservationFixture['build']['edition']
  if (!['base', 'mission-cd', 'amazons', 'gold', 'amazons-demo'].includes(edition)) throw new Error('Unknown original edition')
  const content = list(build.content, 'build.content').map((entry, index) => file(entry, `build.content[${index}]`))
  if (!content.length || new Set(content.map(entry => entry.path)).size !== content.length) throw new Error('Content manifest must contain unique file paths')
  const settings = object(fixture.settings, 'settings')
  if (Object.keys(settings).length > 64) throw new Error('Too many starting settings')
  const normalizedSettings: Record<string, string | number | boolean> = Object.fromEntries(Object.entries(settings).map(([key, entry]) => {
    text(key, 'settings key')
    if (typeof entry === 'string') text(entry, `settings.${key}`)
    else if (typeof entry !== 'boolean' && (typeof entry !== 'number' || !Number.isFinite(entry))) throw new Error(`Invalid setting: ${key}`)
    return [key, entry]
  }))
  const procedure = list(fixture.procedure, 'procedure', 256).map((entry, index) => text(entry, `procedure[${index}]`))
  if (!procedure.length) throw new Error('A repeatable procedure is required')
  let previousTime = 0
  const commands = list(fixture.commands, 'commands').map((entry, index) => {
    const command = object(entry, `commands[${index}]`)
    keys(command, ['sequence', 'atMs', 'instruction'], `commands[${index}]`)
    if (command.sequence !== index) throw new Error('Commands must use contiguous ordered sequence numbers')
    const atMs = integer(command.atMs, `commands[${index}].atMs`)
    if (atMs < previousTime) throw new Error('Command times must be ordered')
    previousTime = atMs
    return { sequence: index, atMs, instruction: text(command.instruction, `commands[${index}].instruction`) }
  })
  const outcomeKeys = list(fixture.outcomeKeys, 'outcomeKeys', 128).map((entry, index) => text(entry, `outcomeKeys[${index}]`))
  if (!outcomeKeys.length || new Set(outcomeKeys).size !== outcomeKeys.length) throw new Error('Unique expected outcome keys are required')
  return {
    schemaVersion: 1, id,
    build: {
      edition, distribution: text(build.distribution, 'build.distribution'),
      displayedVersion: build.displayedVersion === null ? null : text(build.displayedVersion, 'build.displayedVersion'),
      locale: text(build.locale, 'build.locale'), executable: file(build.executable, 'build.executable'), content,
    },
    initialState: file(fixture.initialState, 'initialState'), settings: normalizedSettings, procedure, commands, outcomeKeys,
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex')
}

export function observationFixtureFingerprint(value: unknown) {
  const fixture = validateObservationFixture(value)
  return {
    fixture: digest(fixture),
    initialState: digest({ build: fixture.build, initialState: fixture.initialState, settings: fixture.settings }),
  }
}
export interface OriginalObservationRun {
  schemaVersion: 1
  fixtureFingerprint: string
  initialStateFingerprint: string
  recordedAt: string
  status: 'completed' | 'interrupted'
  durationMs: number
  environment: { os: string, runtime: string, width: number, height: number }
  commands: OriginalObservationFixture['commands']
  outcomes: { key: string, atMs: number, value: string | number | boolean }[]
  captures: { role: 'initial' | 'final' | 'visual' | 'audio', atMs: number, file: ObservationFile }[]
}

export function validateObservationRun(value: unknown, fixture: OriginalObservationFixture): OriginalObservationRun {
  const run = object(value, 'run')
  keys(run, ['schemaVersion', 'fixtureFingerprint', 'initialStateFingerprint', 'recordedAt', 'status', 'durationMs', 'environment', 'commands', 'outcomes', 'captures'], 'run')
  if (run.schemaVersion !== 1 || !['completed', 'interrupted'].includes(String(run.status))) throw new Error('Unsupported observation run schema or status')
  const fingerprints = observationFixtureFingerprint(fixture)
  if (run.initialStateFingerprint !== fingerprints.initialState) throw new Error('Changed starting conditions')
  if (run.fixtureFingerprint !== fingerprints.fixture) throw new Error('Changed fixture procedure or commands')
  const durationMs = integer(run.durationMs, 'run.durationMs')
  const recordedAt = text(run.recordedAt, 'run.recordedAt')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt)) || new Date(recordedAt).toISOString() !== recordedAt)
    throw new Error('Invalid recording timestamp')
  const environment = object(run.environment, 'run.environment')
  keys(environment, ['os', 'runtime', 'width', 'height'], 'run.environment')
  const width = integer(environment.width, 'run.environment.width'), height = integer(environment.height, 'run.environment.height')
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new Error('Unsupported capture dimensions')
  let previousTime = 0
  const commands = list(run.commands, 'run.commands').map((entry, index) => {
    const command = object(entry, `run.commands[${index}]`)
    keys(command, ['sequence', 'atMs', 'instruction'], `run.commands[${index}]`)
    const expected = fixture.commands[index]
    if (!expected || command.sequence !== index || command.instruction !== expected.instruction) throw new Error('Observed commands differ from the ordered fixture')
    const atMs = integer(command.atMs, `run.commands[${index}].atMs`)
    if (atMs < previousTime || atMs > durationMs) throw new Error('Observed command times must be ordered within the run')
    previousTime = atMs
    return { sequence: index, atMs, instruction: expected.instruction }
  })
  const seenOutcomes = new Set<string>()
  const outcomes = list(run.outcomes, 'run.outcomes', 128).map((entry, index) => {
    const outcome = object(entry, `run.outcomes[${index}]`)
    keys(outcome, ['key', 'atMs', 'value'], `run.outcomes[${index}]`)
    const key = text(outcome.key, `run.outcomes[${index}].key`)
    if (!fixture.outcomeKeys.includes(key) || seenOutcomes.has(key)) throw new Error('Unknown or duplicate outcome key')
    seenOutcomes.add(key)
    const atMs = integer(outcome.atMs, `run.outcomes[${index}].atMs`)
    if (atMs > durationMs) throw new Error('Outcome time lies outside the run')
    const value = outcome.value
    if (typeof value === 'string') text(value, `run.outcomes[${index}].value`)
    else if (typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid observed outcome')
    return { key, atMs, value: value as string | number | boolean }
  })
  const captures = list(run.captures, 'run.captures', 128).map((entry, index) => {
    const capture = object(entry, `run.captures[${index}]`)
    keys(capture, ['role', 'atMs', 'file'], `run.captures[${index}]`)
    const role = text(capture.role, `run.captures[${index}].role`) as OriginalObservationRun['captures'][number]['role']
    if (!['initial', 'final', 'visual', 'audio'].includes(role)) throw new Error('Unsupported capture role')
    const atMs = integer(capture.atMs, `run.captures[${index}].atMs`)
    if (atMs > durationMs || (role === 'initial' && atMs !== 0) || (role === 'final' && atMs !== durationMs)) throw new Error('Capture time does not match its role')
    return { role, atMs, file: file(capture.file, `run.captures[${index}].file`) }
  })
  for (const role of ['initial', 'final', 'audio']) {
    if (captures.filter(capture => capture.role === role).length > 1) throw new Error(`Duplicate capture role: ${role}`)
  }
  if (new Set(captures.map(capture => capture.file.path)).size !== captures.length) throw new Error('Capture files must have unique paths')
  return {
    schemaVersion: 1, fixtureFingerprint: fingerprints.fixture, initialStateFingerprint: fingerprints.initialState,
    recordedAt, status: run.status as OriginalObservationRun['status'], durationMs,
    environment: { os: text(environment.os, 'run.environment.os'), runtime: text(environment.runtime, 'run.environment.runtime'), width, height },
    commands, outcomes, captures,
  }
}

async function verifyFile(root: string, entry: ObservationFile, capture: boolean): Promise<Buffer | null> {
  const path = await realpath(resolve(root, entry.path))
  const inside = relative(root, path)
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Evidence path escapes its selected root: ${entry.path}`)
  const info = await stat(path)
  const maximum = capture ? 64 * 1024 * 1024 : 512 * 1024 * 1024
  if (!info.isFile() || info.size > maximum) throw new Error(`Unsupported evidence file size or type: ${entry.path}`)
  const chunks: Uint8Array[] = []
  const hasher = new Bun.CryptoHasher('sha256')
  let total = 0
  for await (const chunk of Bun.file(path).stream()) {
    total += chunk.byteLength
    if (total > maximum) throw new Error(`Evidence byte bound exceeded: ${entry.path}`)
    hasher.update(chunk)
    if (capture) chunks.push(chunk)
  }
  if (hasher.digest('hex') !== entry.sha256) throw new Error(`Source checksum mismatch: ${entry.path}`)
  return capture ? Buffer.concat(chunks) : null
}

function pcmDuration(bytes: Buffer): number {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length)
    throw new Error('Audio capture must be a complete RIFF/WAVE file')
  let byteRate = 0, blockAlign = 0, dataBytes: number | null = null
  let at = 12
  while (at < bytes.length) {
    if (at + 8 > bytes.length) throw new Error('Truncated WAVE chunk header')
    const kind = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8
    const end = start + size
    if (end + size % 2 > bytes.length) throw new Error('Truncated WAVE chunk')
    if (kind === 'fmt ') {
      if (byteRate || size < 16 || bytes.readUInt16LE(start) !== 1) throw new Error('Audio capture requires one PCM format chunk')
      const channels = bytes.readUInt16LE(start + 2), rate = bytes.readUInt32LE(start + 4), bits = bytes.readUInt16LE(start + 14)
      byteRate = bytes.readUInt32LE(start + 8); blockAlign = bytes.readUInt16LE(start + 12)
      if (!channels || channels > 8 || rate < 8000 || rate > 192000 || ![8, 16, 24, 32].includes(bits)
        || blockAlign !== channels * bits / 8 || byteRate !== rate * blockAlign) throw new Error('Invalid PCM audio format')
    }
    if (kind === 'data') {
      if (dataBytes !== null) throw new Error('Multiple WAVE data chunks are unsupported')
      dataBytes = size
    }
    at = end + size % 2
  }
  if (!byteRate || !blockAlign || dataBytes === null || dataBytes % blockAlign) throw new Error('Incomplete PCM audio capture')
  return dataBytes * 1000 / byteRate
}

export async function verifyOriginalObservation(fixtureValue: unknown, runValue: unknown, roots: { original: string, evidence: string }) {
  const fixture = validateObservationFixture(fixtureValue), run = validateObservationRun(runValue, fixture)
  const original = await realpath(roots.original), evidence = await realpath(roots.evidence)
  for (const source of [fixture.build.executable, ...fixture.build.content, fixture.initialState]) await verifyFile(original, source, false)
  for (const capture of run.captures) {
    const bytes = (await verifyFile(evidence, capture.file, true))!
    if (capture.role === 'audio') {
      if (capture.atMs !== 0 || pcmDuration(bytes) < run.durationMs) throw new Error('Audio capture does not cover the recorded run')
    }
    else {
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
        || bytes.readUInt32BE(16) !== run.environment.width || bytes.readUInt32BE(20) !== run.environment.height)
        throw new Error('PNG capture dimensions do not match the recorded display')
      png.sync.read(bytes, { maxDecodedBytes: 64 * 1024 * 1024 })
    }
  }
  const missing = [
    ...['initial', 'final', 'audio'].filter(role => !run.captures.some(capture => capture.role === role)).map(role => `capture:${role}`),
    ...fixture.outcomeKeys.filter(key => !run.outcomes.some(outcome => outcome.key === key)).map(key => `outcome:${key}`),
    ...(run.commands.length === fixture.commands.length ? [] : ['ordered-commands']),
  ]
  if (run.status === 'completed' && missing.length) throw new Error(`Completed run lacks required evidence: ${missing.join(', ')}`)
  return {
    status: run.status === 'completed' ? 'complete-candidate' as const : 'interrupted-candidate' as const,
    evidenceClass: 'candidate-original-observation' as const,
    originalBehaviorAdmitted: false as const,
    fixtureId: fixture.id, edition: fixture.build.edition,
    fingerprints: { ...observationFixtureFingerprint(fixture), run: digest(run) }, run, missing,
  }
}

export function compareOriginalObservations(left: Awaited<ReturnType<typeof verifyOriginalObservation>>, right: Awaited<ReturnType<typeof verifyOriginalObservation>>, toleranceMs = 0) {
  if (!Number.isSafeInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 60_000) throw new Error('Timing tolerance must be an explicit integer from 0 to 60000 ms')
  if (digest(left.run) === digest(right.run)) throw new Error('Same run cannot establish independent repetition')
  const differences: string[] = []
  const timingDeltas: { field: string, deltaMs: number }[] = []
  let status: 'different-starting-conditions' | 'different-procedure' | 'incomplete-candidates' | 'different-environment' | 'different-outcomes' | 'different-timings' | 'different-media' | 'matching-candidates' = 'matching-candidates'
  if (left.fingerprints.initialState !== right.fingerprints.initialState) status = 'different-starting-conditions'
  else if (left.fingerprints.fixture !== right.fingerprints.fixture) status = 'different-procedure'
  else if (left.status !== 'complete-candidate' || right.status !== 'complete-candidate') status = 'incomplete-candidates'
  else if (canonical(left.run.environment) !== canonical(right.run.environment)) status = 'different-environment'
  else {
    timingDeltas.push({ field: 'duration', deltaMs: right.run.durationMs - left.run.durationMs })
    for (const [index, command] of left.run.commands.entries()) {
      timingDeltas.push({ field: `command:${index}`, deltaMs: right.run.commands[index]!.atMs - command.atMs })
    }
    for (const outcome of left.run.outcomes) {
      const repeated = right.run.outcomes.find(item => item.key === outcome.key)!
      if (canonical(repeated.value) !== canonical(outcome.value)) differences.push(`outcome:${outcome.key}`)
      timingDeltas.push({ field: `outcome:${outcome.key}`, deltaMs: repeated.atMs - outcome.atMs })
    }
    const mediaOrder = (a: OriginalObservationRun['captures'][number], b: OriginalObservationRun['captures'][number]) =>
      a.role < b.role ? -1 : a.role > b.role ? 1 : a.atMs - b.atMs
    const leftMedia = [...left.run.captures].sort(mediaOrder), rightMedia = [...right.run.captures].sort(mediaOrder)
    let mediaMatch = leftMedia.length === rightMedia.length
    for (const [index, capture] of leftMedia.entries()) {
      const repeated = rightMedia[index]
      if (!repeated) continue
      timingDeltas.push({ field: `capture:${capture.role}:${index}`, deltaMs: repeated.atMs - capture.atMs })
      if (capture.role !== repeated.role || capture.file.sha256 !== repeated.file.sha256) mediaMatch = false
    }
    if (differences.length) status = 'different-outcomes'
    else if (timingDeltas.some(delta => Math.abs(delta.deltaMs) > toleranceMs)) status = 'different-timings'
    else if (!mediaMatch) status = 'different-media'
  }
  return { status, toleranceMs, differences, timingDeltas, independentExecutionVerified: false as const, originalBehaviorAdmitted: false as const }
}
