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

/**
 * Re-executes a replay from its start state. Reports the first tick whose state
 * checksum differs, which is the first divergent tick across runtimes.
 * Transition diagnostics use the starting tick; final snapshot diagnostics use
 * the end tick. Malformed recording data is rejected before simulation.
 */
export function verify(replay: Replay, rules: RulesProfile): Verification {
  if (replay?.format !== REPLAY_FORMAT || ![1, 2].includes(replay.version) || !Array.isArray(replay.checksums)
    || (replay.version === 1 ? !Array.isArray(replay.commands) : !Array.isArray(replay.submissions))) throw new TypeError('Not a replay')
  const session = restore(replay.start, rules)
  try {
    const first = session.state.tick
    if (!Number.isSafeInteger(replay.end) || replay.end < first || replay.end - first !== replay.checksums.length)
      throw new TypeError('Replay interval does not match the recorded checksums')
    const isChecksum = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)
    for (const expected of replay.checksums) if (!isChecksum(expected)) throw new TypeError('Replay checksum is invalid')
    if (replay.version === 2 && !isChecksum(replay.checksum)) throw new TypeError('Replay checksum is invalid')
    // Format 1 had no arrival times and interpreted a command's execution
    // tick as its arrival tick. Retain that interpretation for old recordings.
    const submissions = replay.version === 1
      ? replay.commands.map(command => ({ at: command.tick, command })).sort((a, b) => a.at - b.at)
      : replay.submissions
    let previous = first
    for (const submission of submissions) {
      if (!submission || !Number.isSafeInteger(submission.at) || submission.at < previous || submission.at > replay.end
        || !submission.command || typeof submission.command !== 'object' || Array.isArray(submission.command))
        throw new TypeError('Replay submission timeline is invalid')
      previous = submission.at
    }
    let next = 0
    const submit = (): Verification | null => {
      while (next < submissions.length && submissions[next]!.at === session.state.tick) {
        const rejected = session.enqueue(structuredClone(submissions[next++]!.command))
        if (rejected) return { ok: false, tick: session.state.tick, expected: replay.checksums[session.state.tick - first] ?? (replay.version === 2 ? replay.checksum : ''), actual: session.checksum(), reason: 'rejected-command', detail: rejected.reason }
      }
      return null
    }
    for (let i = 0; i < replay.checksums.length; i++) {
      const rejected = submit()
      if (rejected) return rejected
      session.advance(1)
      const actual = session.checksum()
      if (actual !== replay.checksums[i]) return { ok: false, tick: first + i, expected: replay.checksums[i]!, actual, reason: 'divergence' }
    }
    const rejected = submit()
    if (rejected) return rejected
    if (replay.version === 2 && session.checksum() !== replay.checksum)
      return { ok: false, tick: session.state.tick, expected: replay.checksum, actual: session.checksum(), reason: 'divergence' }
    return { ok: true, ticks: replay.checksums.length, checksum: session.checksum() }
  }
  finally { session.dispose() }
}
