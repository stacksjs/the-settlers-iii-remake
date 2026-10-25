import type { Point } from './geometry'
import type { Session } from './session'
import { inside } from './geometry'

/** Expands square rings in the keyboard control's row/column order, checking each map tile at most once. */
export function findBuildingSite(session: Session, player: number, type: string, origin: Point): Point | null {
  const map = session.state.map
  if (!Number.isInteger(origin.x) || !Number.isInteger(origin.y) || !inside(map, origin.x, origin.y) || !session.rules.buildings.some(b => b.id === type)) return null
  const permitted = (x: number, y: number): boolean => inside(map, x, y) && map.owner[y * map.width + x] === player && !session.placement(player, type, x, y)
  const limit = Math.max(origin.x, map.width - 1 - origin.x, origin.y, map.height - 1 - origin.y)
  for (let radius = 0; radius <= limit; radius++) {
    for (let y = Math.max(0, origin.y - radius); y <= Math.min(map.height - 1, origin.y + radius); y++) {
      if (Math.abs(y - origin.y) === radius) {
        for (let x = Math.max(0, origin.x - radius); x <= Math.min(map.width - 1, origin.x + radius); x++) {
          if (permitted(x, y)) return { x, y }
        }
      }
      else {
        for (const x of [origin.x - radius, origin.x + radius]) if (permitted(x, y)) return { x, y }
      }
    }
  }
  return null
}
