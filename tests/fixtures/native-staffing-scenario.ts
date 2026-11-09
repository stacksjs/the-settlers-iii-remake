import { createSession, describeMap, ROMAN_ENGINEERING } from '../../resources/game/engine/runtime'

/** Same full construction scenario for one-shot and retained native hosting. */
export function nativeStaffingScenario() {
  const rules = ROMAN_ENGINEERING
  return createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [{
    name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'builder', x: 40, y: 10 }, ...Array.from({ length: 12 }, (_, i) => ({ profession: 'carrier', x: 32 + i, y: 46 }))] },
  }], piles: [{ x: 38, y: 44, good: 'plank', amount: 4 }, { x: 39, y: 44, good: 'stone', amount: 4 }, { x: 40, y: 44, good: 'hammer', amount: 2 }] })
}
