import type { MissionDefinition } from './engine'

/** Two-player elimination, following the pinned remake's completed military-building check.
 * This is engineering evidence, not an observation of the Gold executable.
 */
export const RIVAL_MISSION: MissionDefinition = {
  id: 'rival-elimination-v1', version: 1,
  objectives: [{ id: 'eliminate-rival', player: 1, text: 'Capture every enemy castle and tower. Keep at least one of your own.' }],
  triggers: [
    {
      id: 'both-defeated',
      when: { kind: 'all', of: [{ kind: 'player-defeated', player: 1 }, { kind: 'player-defeated', player: 2 }] },
      then: [{ kind: 'fail-objective', objective: 'eliminate-rival' }, { kind: 'defeat', player: 1 }, { kind: 'defeat', player: 2 }],
    },
    {
      id: 'rival-defeated',
      when: { kind: 'all', of: [{ kind: 'player-defeated', player: 2 }, { kind: 'not', of: { kind: 'player-defeated', player: 1 } }] },
      then: [{ kind: 'complete-objective', objective: 'eliminate-rival' }, { kind: 'victory', player: 1 }, { kind: 'defeat', player: 2 }],
    },
    {
      id: 'rome-defeated',
      when: { kind: 'all', of: [{ kind: 'player-defeated', player: 1 }, { kind: 'not', of: { kind: 'player-defeated', player: 2 } }] },
      then: [{ kind: 'fail-objective', objective: 'eliminate-rival' }, { kind: 'defeat', player: 1 }, { kind: 'victory', player: 2 }],
    },
  ],
}
