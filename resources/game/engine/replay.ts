import type { RulesProfile } from './rules'
import type { SaveEnvelope } from './save'
import type { Session } from './session'
import type { Command, CommandResult } from './state'
import { restore, save } from './save'

export const REPLAY_FORMAT = 'settlers-iii-remake/replay'
export interface Replay {
  format: typeof REPLAY_FORMAT, version: 1
  start: SaveEnvelope
  /** Every accepted command in submission order. */
  commands: Command[]
  /** State checksum after each recorded tick. */
  checksums: string[]
  end: number
}

export interface Recorder { session: Session, enqueue: (command: Command) => CommandResult | null, advance: (ticks?: number) => void, replay: () => Replay }

/** Wraps a session so every accepted command and the checksum after every tick are retained. */
export function record(session: Session): Recorder {
  const start = save(session), commands: Command[] = [], checksums: string[] = []
  return {
    session,
    enqueue(command) { const rejected = session.enqueue(command); if (!rejected) commands.push(structuredClone(command)); return rejected },
    advance(ticks = 1) { for (let i = 0; i < ticks; i++) { session.advance(1); checksums.push(session.checksum()) } },
    replay: () => ({ format: REPLAY_FORMAT, version: 1, start: structuredClone(start), commands: structuredClone(commands), checksums: [...checksums], end: session.state.tick }),
  }
}

export type Verification = { ok: true, ticks: number, checksum: string } | { ok: false, tick: number, expected: string, actual: string, reason: 'divergence' | 'rejected-command', detail?: string }

/**
 * Re-executes a replay from its start state. Reports the first tick whose state
 * checksum differs, which is the first divergent tick across runtimes.
 */
export function verify(replay: Replay, rules: RulesProfile): Verification {
  if (replay?.format !== REPLAY_FORMAT || replay.version !== 1 || !Array.isArray(replay.commands) || !Array.isArray(replay.checksums)) throw new TypeError('Not a replay')
  const session = restore(replay.start, rules)
  try {
    const first = session.state.tick, byTick = new Map<number, Command[]>()
    for (const c of replay.commands) byTick.set(c.tick, [...(byTick.get(c.tick) ?? []), c])
    for (let i = 0; i < replay.checksums.length; i++) {
      for (const c of byTick.get(session.state.tick) ?? []) {
        const rejected = session.enqueue(structuredClone(c))
        if (rejected) return { ok: false, tick: session.state.tick, expected: replay.checksums[i]!, actual: session.checksum(), reason: 'rejected-command', detail: rejected.reason }
      }
      session.advance(1)
      const actual = session.checksum()
      if (actual !== replay.checksums[i]) return { ok: false, tick: first + i, expected: replay.checksums[i]!, actual, reason: 'divergence' }
    }
    return { ok: true, ticks: replay.checksums.length, checksum: session.checksum() }
  }
  finally { session.dispose() }
}
