import type { Point, Session } from './engine'
import { distance } from './engine'

// Troop selection and orders as the original manual describes them
// (military.htm, "How to Direct Soldiers"): click or drag a rectangle to mark
// soldiers, SHIFT adds to the marked group, ALT marks every soldier of the
// clicked type nearby, ALT + number stores a group, the number recalls it and
// the number again centers the view. A right click moves; with CTRL the move
// ignores enemies, with SHIFT it adds a waypoint, with ALT it patrols.
// Selection is the player's interface state; only the resulting orders enter
// the simulation, as ordinary commands.

export interface Modifiers { shift?: boolean, alt?: boolean, ctrl?: boolean }
export type TroopOrder = { type: 'move-soldiers', soldiers: number[], x: number, y: number, mode?: 'forced' | 'patrol', append?: true } | { type: 'attack', soldiers: number[], building: number }

/** How far ALT reaches when marking one type. The manual says only "a wider radius"; engineering choice, S3-052. */
export const TYPE_RADIUS = 12

export function createTroops(session: () => Session | null, player: number) {
  let marked: number[] = [], lastRecall = 0
  const groups = new Map<number, number[]>()
  const alive = (ids: number[]): number[] => {
    const s = session()
    return s ? ids.filter(id => { const p = s.state.settlers.get(id); return p?.owner === player && !!p.soldier }) : []
  }
  const mark = (ids: number[], mods: Modifiers): void => {
    marked = alive(mods.shift ? [...new Set([...marked, ...ids])] : [...new Set(ids)])
    lastRecall = 0
  }
  return {
    /** The marked soldiers who still serve this player. */
    selected: (): number[] => (marked = alive(marked)),
    /** A click on one soldier, or on nothing. */
    click(soldier: number | null, mods: Modifiers = {}): void {
      const s = session(), hit = soldier === null ? undefined : s?.state.settlers.get(soldier)
      if (!s || !hit || hit.owner !== player || !hit.soldier) { if (!mods.shift) mark([], {}); return }
      if (!mods.alt) { mark([hit.id], mods); return }
      const sameType = [...s.state.settlers.values()].filter(p => p.owner === player && p.soldier && !p.inside && p.profession === hit.profession && distance(p, hit) <= TYPE_RADIUS)
      mark(sameType.map(p => p.id), mods)
    },
    /** Soldiers enclosed by a dragged rectangle. */
    band(ids: number[], mods: Modifiers = {}): void { mark(ids, mods) },
    clear(): void { marked = []; lastRecall = 0 },
    /**
     * A number key: with ALT it stores the marked soldiers as that group; without,
     * it marks the group, and pressed again it returns where to center the view.
     */
    key(digit: number, mods: Modifiers = {}): Point | null {
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null
      if (mods.alt) { groups.set(digit, alive(marked)); lastRecall = 0; return null }
      const group = alive(groups.get(digit) ?? [])
      groups.set(digit, group)
      const again = lastRecall === digit
      marked = group; lastRecall = digit
      const s = session()
      if (!again || !s || !group.length) return null
      const people = group.map(id => s.state.settlers.get(id)!)
      return { x: Math.round(people.reduce((a, p) => a + p.x, 0) / people.length), y: Math.round(people.reduce((a, p) => a + p.y, 0) / people.length) }
    },
    /** A right click at a tile: the order it gives the marked soldiers, or null when none are marked. */
    order(target: Point, mods: Modifiers = {}): TroopOrder | null {
      const s = session(), soldiers = alive(marked)
      if (!s || !soldiers.length) return null
      const map = s.state.map, building = s.state.buildings.get(s.context.index.buildingAt[target.y * map.width + target.x] ?? 0)
      const enemy = building && building.owner !== player && s.context.building.get(building.type)?.garrison
      if (enemy && !mods.ctrl && !mods.alt && !mods.shift) return { type: 'attack', soldiers, building: building.id }
      return { type: 'move-soldiers', soldiers, x: target.x, y: target.y, ...(mods.ctrl ? { mode: 'forced' as const } : mods.alt ? { mode: 'patrol' as const } : {}), ...(mods.shift ? { append: true as const } : {}) }
    },
  }
}
export type Troops = ReturnType<typeof createTroops>
