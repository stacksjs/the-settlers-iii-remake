import type { Point, Session } from './engine'
import { toView } from './engine'
import { geologistSurveyImage } from './geologist-images'
import { surveyMarker } from './survey-signs'
import { SHADOW_ROW_OFFSET } from './shadow-images'
import { perceivedAge, perceivedAmount, perceivedHeight, perceivedObject } from './engine/perception'

// The scene is everything a player's screen shows, derived only from the
// session and that player's sight. The canvas painter draws it; tests compare it
// with the simulation. Each item is a live entity or a retained observation.
export interface SceneItem {
  kind: 'tree' | 'sapling' | 'stone' | 'crop' | 'pile' | 'building' | 'site' | 'settler' | 'shadow' | 'sign' | 'arrow'
  /** Sprite key and frame in the original atlas. Arrows have no sprite. */
  sprite: string, frame: number
  /** Projection and map-row depth are independent, as in MapObjectDrawer.getZ. */
  view: Point, depth: number
  /** Original map scan order breaks equal-depth ties independently of projection. */
  tile: number
  /** Simulation entity: tile for objects and signs, id for piles, buildings and settlers. */
  entity: number, owner: number
  /** Construction share built in, for sites. */
  reveal?: number
  /** Growth share for saplings and crops. */
  growth?: number
  good?: string, amount?: number, action?: string, phase?: string, suspended?: boolean
  /** Soldier rank and remaining health share. */
  rank?: number, health?: number
  /** Share of a strike or shot completed; the frame is then the direction, and the painter picks the step within it. */
  progress?: number
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
      const t = y * map.width + x, object = perceivedObject(map, viewer, t)
      if (!object || !viewer.explored[t]) continue
      const rule = rules.objects[object - 1]!, view = toView(x, y, perceivedHeight(map, viewer, t))
      const age = perceivedAge(map, viewer, t, state.tick), growth = rule.grows ? Math.min(0.999, age / rule.grows.ticks) : 1
      const base = { view, depth: y, tile: t, entity: t, owner: 0 }
      const variety = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 7
      if (rule.id === 'tree') items.push({ ...base, kind: 'tree', sprite: `tree-${variety}`, frame: 0 })
      // The painter maps growth onto however many sapling frames the atlas holds.
      else if (rule.id === 'sapling') items.push({ ...base, kind: 'sapling', sprite: 'sapling', frame: 0, growth })
      else if (rule.id === 'stone') { const amount = perceivedAmount(map, viewer, t); items.push({ ...base, kind: 'stone', sprite: 'stone-deposit', frame: amount > 8 ? 0 : amount > 4 ? 1 : 2, amount }) }
      else if (rule.id === 'field') items.push({ ...base, kind: 'crop', sprite: 'crop', frame: Math.floor(growth * 7) })
      else if (rule.id === 'ripe-grain') items.push({ ...base, kind: 'crop', sprite: 'crop', frame: 7 })
      else if (rule.id === 'vine') items.push({ ...base, kind: 'crop', sprite: 'vine', frame: Math.floor(growth * 3) })
      else if (rule.id === 'ripe-vine') items.push({ ...base, kind: 'crop', sprite: 'vine', frame: 3 })
    }
  }
  const piles = new Map<number, number>()
  const visibleStacks = [...state.stacks.values()].filter(st => seen(st.tile) || (!viewer.memory && st.owner === options.player))
  for (const st of [...visibleStacks, ...(viewer.memory?.stacks ?? [])]) {
    if (st.amount < 1) continue
    const x = st.tile % map.width, y = Math.floor(st.tile / map.width)
    if (y < yMin || y > yMax) continue
    // Piles lie on their own tiles; several piles waiting at one door fan out beside it.
    const slot = piles.get(st.tile) ?? 0
    piles.set(st.tile, slot + 1)
    const base = toView(x, y, 'elevation' in st ? st.elevation : map.elevation[st.tile]!), view = { x: base.x + (slot ? 10 + ((slot - 1) % 3) * 9 : 0), y: base.y + (slot ? Math.floor((slot - 1) / 3) * 6 - 2 : 0) }
    items.push({ kind: 'pile', sprite: `stack:${st.good}`, frame: Math.min(8, st.amount) - 1, view, depth: Math.floor(st.tile / map.width), tile: st.tile, entity: st.id, owner: st.owner, good: st.good, amount: st.amount })
  }
  for (const b of [...state.buildings.values(), ...(viewer.memory?.buildings ?? [])]) {
    const rule = rules.buildings.find(r => r.id === b.type)!
    const remembered = 'elevation' in b
    if (!remembered && b.owner !== options.player && !rule.footprint.some(([dx, dy]) => seen((b.y + dy) * map.width + b.x + dx))) continue
    if (b.y < yMin - 10 || b.y > yMax + 10) continue
    const view = toView(b.x, b.y, remembered ? b.elevation : map.elevation[b.y * map.width + b.x]!)
    const total = Object.values(rule.cost).reduce((a, n) => a + n, 0) || 1
    const suspended = !remembered && b.owner === options.player && b.suspended
    if (b.phase === 'active') items.push({ kind: 'building', sprite: `building:${b.type}`, frame: 0, view, depth: b.y, tile: b.y * map.width + b.x, entity: b.id, owner: b.owner, phase: b.phase, suspended })
    else items.push({ kind: 'site', sprite: `site:${b.type}`, frame: 0, view, depth: b.y + 1, tile: b.y * map.width + b.x, entity: b.id, owner: b.owner, phase: b.phase, reveal: b.phase === 'building' ? (total - b.workRemaining) / total : 0, suspended })
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
    let frame = spriteDirection(s.dir) * 12 + (walking && !options.reduceMotion ? 1 + Math.floor(step * 11) % 11 : 0)
    // Soldiers wear their rank's original sequence; health is shown as a share of the rank's maximum.
    const soldier = s.soldier ? rules.professions.find(p => p.id === s.profession)?.soldier : undefined
    // A soldier between blows plays its rank's strike sequence; its direction faces the target.
    const striking = !!soldier && s.action === 'working' && s.soldier!.cooldown > 0
    let sprite = soldier ? `${striking ? 'strike' : 'soldier'}:${s.profession}-${s.soldier!.rank}` : s.cargo ? `carry:${s.cargo}` : s.profession === rules.religion?.priest ? 'priest' : s.profession === 'geologist' ? 'geologist' : 'worker'
    const work = s.program?.steps[s.program.pc]
    if (!s.cargo && s.profession === 'geologist' && s.action === 'working' && s.program?.kind === 'duty' && work?.op === 'work') {
      const image = geologistSurveyImage(options.reduceMotion ? 0 : (s.step - 1) / Math.max(1, work.ticks - 1))
      sprite = image.sprite; frame = image.frame
    }
    const body: SceneItem = { kind: 'settler', sprite, frame: striking ? spriteDirection(s.dir) : frame, view, ...(striking ? { progress: 1 - s.soldier!.cooldown / soldier!.attackTicks } : {}), depth: s.y, tile: t, entity: s.id, owner: s.owner, action: s.action, ...(s.cargo ? { good: s.cargo } : {}), ...(soldier ? { rank: s.soldier!.rank, health: s.soldier!.health / soldier.health[s.soldier!.rank - 1]! } : {}) }
    // The reference adds 20*z_per_y to fragment depth. Its ortho projection
    // maps Z with factor -1/2, placing a shadow 40 map rows behind its body.
    // A separate ordered layer preserves occlusion even on steep terrain.
    items.push({ kind: 'shadow', sprite: body.sprite, frame: body.frame, view: body.view, progress: body.progress, depth: s.y - SHADOW_ROW_OFFSET, tile: t, entity: s.id, owner: s.owner }, body)
  }
  for (const p of state.projectiles ?? []) {
    if (!seen(p.from) && !seen(p.to)) continue
    const at = (t: number): Point => toView(t % map.width, Math.floor(t / map.width), map.elevation[t]!)
    const from = at(p.from), to = at(p.to), share = Math.min(1, Math.max(0, (state.tick - p.fired) / Math.max(1, p.arrives - p.fired)))
    // Arrows rise and fall along their flight; the simulation only knows when they land.
    const view = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share - Math.sin(share * Math.PI) * 24 }
    items.push({ kind: 'arrow', sprite: '', frame: 0, view, depth: Math.floor(p.from / map.width) + (Math.floor(p.to / map.width) - Math.floor(p.from / map.width)) * share, tile: p.from, entity: p.id, owner: p.owner, from, to })
  }
  for (const sign of [...viewer.signs.filter(sign => sign.until > state.tick && (!viewer.memory || seen(sign.tile))), ...(viewer.memory?.signs ?? [])]) {
    const x = sign.tile % map.width, y = Math.floor(sign.tile / map.width), view = toView(x, y, 'elevation' in sign ? sign.elevation : map.elevation[sign.tile]!)
    items.push({ kind: 'sign', ...surveyMarker(sign.good ?? undefined, sign.amount), view, depth: y, tile: sign.tile, entity: sign.tile, owner: options.player, ...(sign.good ? { good: sign.good } : {}), amount: sign.amount })
  }
  return items.sort((a, b) => a.depth - b.depth || a.tile - b.tile || Number(a.kind === 'settler') - Number(b.kind === 'settler') || a.entity - b.entity)
}
