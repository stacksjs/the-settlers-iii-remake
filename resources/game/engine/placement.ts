import type { Point } from './geometry'
import type { Session } from './session'
import { inside } from './geometry'
import { harvestableSite } from './production'

/** Prefer known reachable harvests, then legal ground, in the keyboard control's nearest-ring order. */
export function findBuildingSite(session: Session, player: number, type: string, origin: Point): Point | null {
  const map = session.state.map
  const rule = session.rules.buildings.find(b => b.id === type)
  if (!Number.isInteger(origin.x) || !Number.isInteger(origin.y) || !inside(map, origin.x, origin.y) || !rule) return null
  const known = session.state.players.find(p => p.id === player)?.explored
  let fallback: Point | null = null
  const preferred = (x: number, y: number): boolean => {
    if (!inside(map, x, y) || map.owner[y * map.width + x] !== player || session.placement(player, type, x, y)) return false
    fallback ??= { x, y }
    return rule.workflow.kind !== 'harvest' || (!!known && harvestableSite(session.context, player, type, x, y, tile => known[tile] === 1))
  }
  const limit = Math.max(origin.x, map.width - 1 - origin.x, origin.y, map.height - 1 - origin.y)
  for (let radius = 0; radius <= limit; radius++) {
    for (let y = Math.max(0, origin.y - radius); y <= Math.min(map.height - 1, origin.y + radius); y++) {
      if (Math.abs(y - origin.y) === radius) {
        for (let x = Math.max(0, origin.x - radius); x <= Math.min(map.width - 1, origin.x + radius); x++) {
          if (preferred(x, y)) return { x, y }
        }
      }
      else {
        for (const x of [origin.x - radius, origin.x + radius]) if (preferred(x, y)) return { x, y }
      }
    }
  }
  return fallback
}
