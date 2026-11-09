import type { RulesProfile } from './rules'
import type { SaveEnvelope } from './save'
import type { Session } from './session'
import type { Command, CommandResult } from './state'
import { restore, save } from './save'

export const REPLAY_FORMAT = 'settlers-iii-remake/replay'
interface ReplayFields {
  format: typeof REPLAY_FORMAT
  start: SaveEnvelope
  /** State checksum after each recorded tick. */
  checksums: string[]
  end: number
}
/** Arrival time is distinct from the command's scheduled execution tick. */
interface Submission { at: number, command: Command }
export type Replay = ReplayFields & (
  | { version: 1, commands: Command[] }
  | { version: 2, submissions: Submission[], checksum: string }
)

export interface Recorder { session: Session, enqueue: (command: Command) => CommandResult | null, advance: (ticks?: number) => void, replay: () => Extract<Replay, { version: 2 }> }

/** Submit and advance through this recorder to retain the complete history. */
export function record(session: Session): Recorder {
  const start = save(session), submissions: Submission[] = [], checksums: string[] = []
  return {
    session,
    enqueue(command) { const rejected = session.enqueue(command); if (!rejected) submissions.push({ at: session.state.tick, command: structuredClone(command) }); return rejected },
    advance(ticks = 1) {
      if (!Number.isInteger(ticks) || ticks < 0 || ticks > 1_000_000) throw new RangeError('Advance by a whole number of ticks.')
      for (let i = 0; i < ticks; i++) { session.advance(1); checksums.push(session.checksum()) }
    },
    replay: () => ({ format: REPLAY_FORMAT, version: 2, start: structuredClone(start), submissions: structuredClone(submissions), checksums: [...checksums], end: session.state.tick, checksum: session.checksum() }),
  }
}

export type Verification = { ok: true, ticks: number, checksum: string } | { ok: false, tick: number, expected: string, actual: string, reason: 'divergence' | 'rejected-command', detail?: string }

/** A detached snapshot of progress. Ticks count successfully verified transitions. */
export interface ReplayProgress { tick: number, ticks: number, total: number, result: Verification | null, disposed: boolean }
export interface ReplayVerifier {
  /** Advance at most this many simulation ticks, then yield to the host. */
  advance: (ticks?: number) => ReplayProgress
  progress: () => ReplayProgress
  dispose: () => void
}

/**
 * Owns one restored simulation and recording snapshot across host callbacks.
 * Validate the complete recording before advancing any simulation ticks. An
 * advance of zero finishes a zero-tick recording, including its final queue.
 * Completion releases the simulation; explicit disposal also cancels work.
 */
export function createReplayVerifier(input: Replay, rules: RulesProfile | readonly RulesProfile[]): ReplayVerifier {
  if (input?.format !== REPLAY_FORMAT || ![1, 2].includes(input.version) || !Array.isArray(input.checksums)
    || (input.version === 1 ? !Array.isArray(input.commands) : !Array.isArray(input.submissions))) throw new TypeError('Not a replay')
  const replay = structuredClone(input)
  let session: Session | null = restore(replay.start, structuredClone(rules))
  try {
    const first = session.state.tick, total = replay.checksums.length
    let checksums = replay.checksums
    const finalChecksum = replay.version === 2 ? replay.checksum : null
    if (!Number.isSafeInteger(replay.end) || replay.end < first || replay.end - first !== total)
      throw new TypeError('Replay interval does not match the recorded checksums')
    const isChecksum = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)
    for (const expected of replay.checksums) if (!isChecksum(expected)) throw new TypeError('Replay checksum is invalid')
    if (replay.version === 2 && !isChecksum(replay.checksum)) throw new TypeError('Replay checksum is invalid')
    // Format 1 had no arrival times and interpreted a command's execution
    // tick as its arrival tick. Retain that interpretation for old recordings.
    let submissions = replay.version === 1
      ? replay.commands.map(command => ({ at: command?.tick, command })).sort((a, b) => a.at - b.at)
      : replay.submissions
    let previous = first
    for (const submission of submissions) {
      if (!submission || !Number.isSafeInteger(submission.at) || submission.at < previous || submission.at > replay.end
        || !submission.command || typeof submission.command !== 'object' || Array.isArray(submission.command))
        throw new TypeError('Replay submission timeline is invalid')
      previous = submission.at
    }
    let next = 0, ticks = 0, tick = first, disposed = false, result: Verification | null = null
    const release = (): void => { session?.dispose(); session = null; checksums = []; submissions = [] }
    const progress = (): ReplayProgress => ({ tick, ticks, total, result: result ? { ...result } : null, disposed })
    const finish = (outcome: Verification): void => { result = outcome; release() }
    const submit = (): Verification | null => {
      while (next < submissions.length && submissions[next]!.at === tick) {
        const rejected = session!.enqueue(submissions[next++]!.command)
        if (rejected) return { ok: false, tick, expected: checksums[ticks] ?? finalChecksum ?? '', actual: session!.checksum(), reason: 'rejected-command', detail: rejected.reason }
      }
      return null
    }
    return {
      progress,
      advance(count = 1) {
        if (disposed) throw new Error('This replay verifier has been disposed.')
        if (!Number.isInteger(count) || count < 0 || count > 1_000_000) throw new RangeError('Advance by a whole number of ticks.')
        if (result) return progress()
        try {
          for (let i = 0; i < count && ticks < total; i++) {
            const rejected = submit()
            if (rejected) { finish(rejected); return progress() }
            session!.advance(1)
            tick = session!.state.tick
            const actual = session!.checksum(), expected = checksums[ticks]!
            if (actual !== expected) { finish({ ok: false, tick: first + ticks, expected, actual, reason: 'divergence' }); return progress() }
            ticks++
          }
          if (ticks === total) {
            const rejected = submit()
            if (rejected) finish(rejected)
            else {
              const actual = session!.checksum()
              finish(finalChecksum !== null && actual !== finalChecksum
                ? { ok: false, tick, expected: finalChecksum, actual, reason: 'divergence' }
                : { ok: true, ticks: total, checksum: actual })
            }
          }
          return progress()
        }
        catch (error) { disposed = true; release(); throw error }
      },
      dispose() { disposed = true; release() },
    }
  }
  catch (error) { session?.dispose(); throw error }
}

/**
 * Re-executes a replay from its start state. Reports the first tick whose state
 * checksum differs, which is the first divergent tick across runtimes.
 * Transition diagnostics use the starting tick; final snapshot diagnostics use
 * the end tick. Malformed recording data is rejected before simulation.
 */
export function verify(replay: Replay, rules: RulesProfile | readonly RulesProfile[]): Verification {
  const verifier = createReplayVerifier(replay, rules)
  try {
    let progress = verifier.advance(0)
    while (!progress.result) progress = verifier.advance(1_000_000)
    return progress.result
  }
  finally { verifier.dispose() }
}
