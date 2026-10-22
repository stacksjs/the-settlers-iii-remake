import type { Point, Session } from './engine'
import { toView } from './engine'

// The scene is everything a player's screen shows, derived only from the
// session and that player's sight. The canvas painter draws it; tests compare it
// with the simulation. Nothing here is decorative: every item is an entity.
export interface SceneItem {
  kind: 'tree' | 'sapling' | 'stone' | 'crop' | 'pile' | 'building' | 'site' | 'settler' | 'sign' | 'arrow'
  /** Sprite key and frame in the original atlas. Signs and arrows have no sprite. */
  sprite: string, frame: number
  view: Point, depth: number
  /** Simulation entity: tile for objects and signs, id for piles, buildings and settlers. */
  entity: number, owner: number
  /** Construction share built in, for sites. */
  reveal?: number
  /** Growth share for saplings and crops. */
  growth?: number
  good?: string, amount?: number, action?: string, phase?: string, suspended?: boolean
  /** Soldier rank and remaining health share. */
  rank?: number, health?: number
  /** Where an arrow flies from and to, in view coordinates. */
  from?: Point, to?: Point
}
export interface SceneOptions { player: number, rows?: [number, number], columns?: (y: number) => [number, number], reduceMotion?: boolean }

/**
 * Original settler sequences hold twelve frames per direction in the order south-west, west,
 * north-west, north-east, east, south-east (the reference remake's movables.txt). The engine's
 * directions run north-east, east, south-east, south-west, west, north-west.
 */
export const spriteDirection = (direction: number): number => (direction + 3) % 6

export function scene(session: Session, options: SceneOptions): SceneItem[] {
  const { state, rules } = session, { map } = state, viewer = state.players.find(p => p.id === options.player)!
  const [yMin, yMax] = options.rows ?? [0, map.height - 1]
  const seen = (t: number): boolean => viewer.visible[t] === 1
  const items: SceneItem[] = []
  for (let y = Math.max(0, yMin); y <= Math.min(map.height - 1, yMax); y++) {
    const [xMin, xMax] = options.columns?.(y) ?? [0, map.width - 1]
    for (let x = Math.max(0, xMin); x <= Math.min(map.width - 1, xMax); x++) {
      const t = y * map.width + x, object = map.object[t]!
      if (!object || !viewer.explored[t]) continue
      const rule = rules.objects[object - 1]!, view = toView(x, y, map.elevation[t]!)
      const age = state.tick - map.objectSince[t]!, growth = rule.grows ? Math.min(0.999, age / rule.grows.ticks) : 1
      const base = { view, depth: view.y, entity: t, owner: 0 }
      const variety = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 7
      if (rule.id === 'tree') items.push({ ...base, kind: 'tree', sprite: `tree-${variety}`, frame: 0 })
      // The painter maps growth onto however many sapling frames the atlas holds.
      else if (rule.id === 'sapling') items.push({ ...base, kind: 'sapling', sprite: 'sapling', frame: 0, growth })
      else if (rule.id === 'stone') items.push({ ...base, kind: 'stone', sprite: 'stone-deposit', frame: map.objectAmount[t]! > 8 ? 0 : map.objectAmount[t]! > 4 ? 1 : 2, amount: map.objectAmount[t]! })
      else if (rule.id === 'field') items.push({ ...base, kind: 'crop', sprite: 'crop', frame: Math.floor(growth * 7) })
      else if (rule.id === 'ripe-grain') items.push({ ...base, kind: 'crop', sprite: 'crop', frame: 7 })
    }
  }
  const piles = new Map<number, number>()
  for (const st of state.stacks.values()) {
    if (st.amount < 1 || (st.owner !== options.player && !seen(st.tile))) continue
    const x = st.tile % map.width, y = Math.floor(st.tile / map.width)
    if (y < yMin || y > yMax) continue
    // Piles lie on their own tiles; several piles waiting at one door fan out beside it.
    const slot = piles.get(st.tile) ?? 0
    piles.set(st.tile, slot + 1)
    const base = toView(x, y, map.elevation[st.tile]!), view = { x: base.x + (slot ? 10 + ((slot - 1) % 3) * 9 : 0), y: base.y + (slot ? Math.floor((slot - 1) / 3) * 6 - 2 : 0) }
    items.push({ kind: 'pile', sprite: `stack:${st.good}`, frame: Math.min(8, st.amount) - 1, view, depth: view.y, entity: st.id, owner: st.owner, good: st.good, amount: st.amount })
  }
  for (const b of state.buildings.values()) {
    const rule = rules.buildings.find(r => r.id === b.type)!
    if (b.owner !== options.player && !rule.footprint.some(([dx, dy]) => seen((b.y + dy) * map.width + b.x + dx))) continue
    if (b.y < yMin - 10 || b.y > yMax + 10) continue
    const view = toView(b.x, b.y, map.elevation[b.y * map.width + b.x]!)
    const total = Object.values(rule.cost).reduce((a, n) => a + n, 0) || 1
    const own = b.owner === options.player
    if (b.phase === 'active') items.push({ kind: 'building', sprite: `building:${b.type}`, frame: 0, view, depth: view.y + 4, entity: b.id, owner: b.owner, phase: b.phase, suspended: own && b.suspended })
    else items.push({ kind: 'site', sprite: `site:${b.type}`, frame: 0, view, depth: view.y + 4, entity: b.id, owner: b.owner, phase: b.phase, reveal: b.phase === 'building' ? (total - b.workRemaining) / total : 0, suspended: own && b.suspended })
  }
  for (const s of state.settlers.values()) {
    if (s.inside) continue
    const t = s.y * map.width + s.x
    if (s.owner !== options.player && !seen(t)) continue
    if (s.y < yMin - 1 || s.y > yMax + 1) continue
    let view = toView(s.x, s.y, map.elevation[t]!)
    const walking = s.action === 'walking' && s.next >= 0, step = walking && s.stepTicks ? s.step / s.stepTicks : 0
    if (walking) {
      // Interpolation only affects drawing; the simulation keeps whole tiles.
      const to = toView(s.next % map.width, Math.floor(s.next / map.width), map.elevation[s.next]!)
      view = { x: view.x + (to.x - view.x) * step, y: view.y + (to.y - view.y) * step }
    }
    const frame = spriteDirection(s.dir) * 12 + (walking && !options.reduceMotion ? 1 + Math.floor(step * 11) % 11 : 0)
    // Soldiers wear their rank's original sequence; health is shown as a share of the rank's maximum.
    const soldier = s.soldier ? rules.professions.find(p => p.id === s.profession)?.soldier : undefined
    const sprite = soldier ? `soldier:${s.profession}-${s.soldier!.rank}` : s.cargo ? `carry:${s.cargo}` : 'worker'
    items.push({ kind: 'settler', sprite, frame, view, depth: view.y + 1, entity: s.id, owner: s.owner, action: s.action, ...(s.cargo ? { good: s.cargo } : {}), ...(soldier ? { rank: s.soldier!.rank, health: s.soldier!.health / soldier.health[s.soldier!.rank - 1]! } : {}) })
  }
  for (const p of state.projectiles ?? []) {
    if (!seen(p.from) && !seen(p.to)) continue
    const at = (t: number): Point => toView(t % map.width, Math.floor(t / map.width), map.elevation[t]!)
    const from = at(p.from), to = at(p.to), share = Math.min(1, Math.max(0, (state.tick - p.fired) / Math.max(1, p.arrives - p.fired)))
    // Arrows rise and fall along their flight; the simulation only knows when they land.
    const view = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share - Math.sin(share * Math.PI) * 24 }
    items.push({ kind: 'arrow', sprite: '', frame: 0, view, depth: view.y + 2, entity: p.id, owner: p.owner, from, to })
  }
  for (const sign of viewer.signs) {
    if (sign.until <= state.tick) continue
    const x = sign.tile % map.width, y = Math.floor(sign.tile / map.width), view = toView(x, y, map.elevation[sign.tile]!)
    items.push({ kind: 'sign', sprite: '', frame: 0, view, depth: view.y, entity: sign.tile, owner: options.player, ...(sign.good ? { good: sign.good } : {}), amount: sign.amount })
  }
  return items.sort((a, b) => a.depth - b.depth || a.entity - b.entity)
}
