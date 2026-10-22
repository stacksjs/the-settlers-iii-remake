import type { Context } from './context'
import type { Settler } from './state'
import { emit, ledger, pointAt, prune, tileOf } from './context'
import { distance } from './geometry'
import { dropCargo } from './logistics'
import { changeProfession, finishers, start } from './settlers'
import { population } from './workforce'

// Thieves (manual: Moving and Using Thieves). Carriers become thieves; to other
// players they look like carriers until an enemy soldier comes near, who then
// pursues them. Sent with a pilfer order, a thief takes one good from a pile on
// someone else's land near the target and carries it home slowly. Loot changes
// owner when taken and is dropped once the thief stands on his own land.

const rules = (ctx: Context) => ctx.rules.thieves!
export const isThief = (ctx: Context, s: Settler): boolean => !!s.thief && s.profession === ctx.rules.thieves?.profession

/** Converts idle carriers into thieves, keeping the carrier ratio. Returns how many were converted. */
export function recruitThieves(ctx: Context, owner: number, count: number): number {
  if (!ctx.rules.thieves) return 0
  const player = ctx.state.players.find(p => p.id === owner)!
  let made = 0
  for (let i = 0; i < count; i++) {
    const people = population(ctx, owner), carriers = people.filter(s => s.profession === 'carrier' && !s.program && !s.inside && !s.cargo && !s.workplace).sort((a, b) => a.id - b.id)
    if (!carriers.length || carriers.length - 1 < Math.ceil(people.length * player.settings.carrierRatio / 100)) break
    const s = carriers[0]!
    changeProfession(ctx, s, rules(ctx).profession)
    const here = tileOf(ctx, s)
    s.thief = { health: rules(ctx).health, uncovered: [], target: here, home: here, steal: false }
    made++
  }
  return made
}

/** Orders a thief to a tile, to pilfer there when steal is set. Any order replaces the last. */
export function orderThief(ctx: Context, owner: number, value: Record<string, unknown>): string | null {
  if (!ctx.rules.thieves) return 'These rules have no thieves.'
  const s = ctx.state.settlers.get(value.thief as number)
  if (!s || s.owner !== owner || !isThief(ctx, s)) return 'Choose one of your thieves.'
  const { x, y } = value
  if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= ctx.state.map.width || (y as number) >= ctx.state.map.height) return 'Choose a tile on the map.'
  if (value.steal !== undefined && typeof value.steal !== 'boolean') return 'Malformed thief order.'
  s.thief!.target = tileOf(ctx, { x: x as number, y: y as number })
  s.thief!.home = tileOf(ctx, s)
  s.thief!.steal = value.steal === true
  if (s.program) s.program = null
  if (s.thief!.steal || s.thief!.target !== tileOf(ctx, s)) start(ctx, s, 'sneak', s.thief!.target, [{ op: 'go', tile: s.thief!.target }])
  return null
}

finishers.set('sneak', () => {})
finishers.set('loot', (_ctx, s, _program, ok) => { if (!ok && s.thief) s.thief.steal = false })
finishers.set('flee', () => {})

/** Piles another player could lose: loose goods and doorsteps on land that is not the thief's. */
function stealable(ctx: Context, s: Settler): number[] {
  const map = ctx.state.map, target = pointAt(ctx, s.thief!.target)
  return [...ctx.state.stacks.values()]
    .filter(st => st.owner !== s.owner && (st.role === 'ground' || st.role === 'output') && st.amount - st.reservedOut > 0 && map.owner[st.tile] !== s.owner && distance(pointAt(ctx, st.tile), target) <= rules(ctx).search)
    .sort((a, b) => distance(pointAt(ctx, a.tile), s) - distance(pointAt(ctx, b.tile), s) || a.id - b.id)
    .map(st => st.id)
}

/** The thieves pass for one tick: disguises fall near enemy soldiers, loot is taken and brought home. */
export function sneak(ctx: Context): void {
  if (!ctx.rules.thieves) return
  const { state } = ctx
  for (const s of [...state.settlers.values()].sort((a, c) => a.id - c.id)) {
    if (!isThief(ctx, s) || s.inside) continue
    const thief = s.thief!
    for (const other of state.settlers.values()) {
      if (other.owner === s.owner || !other.soldier || other.inside || thief.uncovered.includes(other.owner)) continue
      if (distance(other, s) <= rules(ctx).uncover) { thief.uncovered.push(other.owner); thief.uncovered.sort((a, b) => a - b); emit(ctx, { player: s.owner, type: 'thief-seen', text: 'Your thief has been seen', entity: s.id }) }
    }
    if (s.action === 'walking') continue
    // Loot is set down as soon as the thief is back on his own land.
    if (s.cargo && state.map.owner[tileOf(ctx, s)] === s.owner) { dropCargo(ctx, s); thief.steal = false; continue }
    if (s.program) continue
    if (s.cargo) { start(ctx, s, 'flee', thief.home, [{ op: 'go', tile: thief.home }]); continue }
    if (!thief.steal) continue
    const id = stealable(ctx, s)[0]
    const pile = id === undefined ? undefined : state.stacks.get(id)
    if (!pile) { thief.steal = false; emit(ctx, { player: s.owner, type: 'thief-empty', text: 'Your thief found nothing to take', entity: s.id }); continue }
    if (tileOf(ctx, s) !== pile.tile) { start(ctx, s, 'loot', pile.id, [{ op: 'go', tile: pile.tile }]); continue }
    // The good changes hands as it is taken.
    pile.amount--
    s.cargo = pile.good
    ledger(ctx, pile.owner).lost = { ...ledger(ctx, pile.owner).lost, [pile.good]: (ledger(ctx, pile.owner).lost?.[pile.good] ?? 0) + 1 }
    ledger(ctx, s.owner).gained = { ...ledger(ctx, s.owner).gained, [pile.good]: (ledger(ctx, s.owner).gained?.[pile.good] ?? 0) + 1 }
    emit(ctx, { player: pile.owner, type: 'theft', text: `A thief took ${pile.good}`, tile: pile.tile })
    prune(ctx, pile)
    start(ctx, s, 'flee', thief.home, [{ op: 'go', tile: thief.home }])
  }
}
