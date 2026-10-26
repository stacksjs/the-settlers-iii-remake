import type { Point } from './geometry'
import type { RulesProfile } from './rules'
import type { PlayerView, Session } from './session'
import { area, inside } from './geometry'
import { harvestableSite } from './production'

/** A mine's fixed extraction radius, forecast from this player's live survey signs only. */
export function surveyedMineForecast(view: Pick<PlayerView, 'player' | 'width' | 'height' | 'tick' | 'signs' | 'owner' | 'explored'>, rules: RulesProfile, type: string): (site: Point) => boolean {
  const work = rules.buildings.find(rule => rule.id === type)?.workflow
  if (work?.kind !== 'extract' || !work.food) return () => false
  // Capture matching knowledge once per search, rather than scanning all signs
  // again for every candidate in a large or densely surveyed settlement.
  const deposits = new Set(view.signs.filter(sign => sign.good === work.resource && sign.amount > 0 && sign.until > view.tick
    && view.owner[sign.tile] === view.player && view.explored[sign.tile] === 1).map(sign => sign.tile))
  return site => inside(view, site.x, site.y) && area(view, site, work.radius).some(tile => deposits.has(tile))
}

/** Prefer known resources, then legal ground, in the keyboard control's nearest-ring order. */
export function findBuildingSite(session: Session, player: number, type: string, origin: Point): Point | null {
  const map = session.state.map
  const rule = session.rules.buildings.find(b => b.id === type)
  if (!Number.isInteger(origin.x) || !Number.isInteger(origin.y) || !inside(map, origin.x, origin.y) || !rule) return null
  const known = session.state.players.find(p => p.id === player)?.explored
  const mine = rule.workflow.kind === 'extract' && !!rule.workflow.food
  const forecast = mine && known ? surveyedMineForecast(session.view(player), session.rules, type) : null
  let fallback: Point | null = null
  const preferred = (x: number, y: number): boolean => {
    if (!inside(map, x, y) || map.owner[y * map.width + x] !== player || session.placement(player, type, x, y)) return false
    fallback ??= { x, y }
    if (mine) return forecast?.({ x, y }) ?? false
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
