import type { MissionDefinition, Session } from './engine'
import { createSession, DEFAULT_START, findStart, generateMap, ROMAN_ENGINEERING } from './engine'

const rules = ROMAN_ENGINEERING

export const DUEL_SIZE = 128
/** Both sides start with a small guard so a duel can be fought from the outset, as in the rival skirmish. */
const DUEL_GUARD: Record<string, number> = { swordsman: 4, bowman: 2 }

/**
 * Two-player elimination for an online match. The same rule as the rival
 * skirmish, stated for both seats: whoever still holds a castle or tower when
 * the other has none wins, and losing both at once is a draw.
 */
export const DUEL_MISSION: MissionDefinition = {
  id: 'duel-elimination-v1', version: 1,
  objectives: [
    { id: 'eliminate-east', player: 1, text: 'Capture every enemy castle and tower. Keep at least one of your own.' },
    { id: 'eliminate-west', player: 2, text: 'Capture every enemy castle and tower. Keep at least one of your own.' },
  ],
  triggers: [
    {
      id: 'both-defeated',
      when: { kind: 'all', of: [{ kind: 'player-defeated', player: 1 }, { kind: 'player-defeated', player: 2 }] },
      then: [{ kind: 'fail-objective', objective: 'eliminate-east' }, { kind: 'fail-objective', objective: 'eliminate-west' }, { kind: 'defeat', player: 1 }, { kind: 'defeat', player: 2 }],
    },
    {
      id: 'west-wins',
      when: { kind: 'all', of: [{ kind: 'player-defeated', player: 2 }, { kind: 'not', of: { kind: 'player-defeated', player: 1 } }] },
      then: [{ kind: 'complete-objective', objective: 'eliminate-east' }, { kind: 'fail-objective', objective: 'eliminate-west' }, { kind: 'victory', player: 1 }, { kind: 'defeat', player: 2 }],
    },
    {
      id: 'east-wins',
      when: { kind: 'all', of: [{ kind: 'player-defeated', player: 1 }, { kind: 'not', of: { kind: 'player-defeated', player: 2 } }] },
      then: [{ kind: 'complete-objective', objective: 'eliminate-west' }, { kind: 'fail-objective', objective: 'eliminate-east' }, { kind: 'victory', player: 2 }, { kind: 'defeat', player: 1 }],
    },
  ],
}

/**
 * Two Roman settlements on one generated landscape, both played by people.
 * Deterministic in its seed, so the server and every client build the same
 * starting state from it (and a client can check the server's snapshot by
 * digest).
 */
export function duelSession(seed: number): Session {
  const map = generateMap(rules, DUEL_SIZE, DUEL_SIZE, seed)
  const west = findStart(rules, map, { x: 34, y: 64 }, 10), east = findStart(rules, map, { x: 94, y: 64 }, 10)
  if (!west || !east || Math.abs(west.x - east.x) < 40) throw new Error('This landscape has no room for two settlements. Try another seed.')
  const settlers = { ...DEFAULT_START.settlers, ...DUEL_GUARD }
  return createSession({
    rules, map, seed, mission: DUEL_MISSION,
    players: [{ name: 'West', civilization: 'roman', start: west, settlers }, { name: 'East', civilization: 'roman', start: east, settlers }],
    content: { id: `duel-${DUEL_SIZE}-v1`, digest: `seed:${seed}` },
  })
}

/** A seed that has room for two settlements, searched deterministically from the one asked for. */
export function playableDuelSeed(seed: number): number {
  for (let offset = 0; offset < 64; offset++) {
    const candidate = (seed + offset) >>> 0 || 1
    try { duelSession(candidate).dispose(); return candidate }
    catch { /* try the next seed */ }
  }
  throw new Error('No landscape with room for two settlements was found.')
}
