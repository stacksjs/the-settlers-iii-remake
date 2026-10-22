import type { Context } from './context'
import type { Building, Player, Religion } from './state'
import { doorOf, emit, record, ruleOf } from './context'
import { slot } from './logistics'
import { spawn } from './settlers'
import { completions } from './workforce'

// Offerings and promotion (manual: Small Temple, Large Temple, How to Promote
// Soldiers). Wine carried to a small temple becomes manna one offering at a
// time; manna buys promotions, which raise the rank of soldiers recruited from
// then on. A large temple adds manna once when completed and brings priests.

export const religionOf = (player: Player): Religion => player.religion ??= { manna: 0, produced: 0, promotions: 0, levels: {}, templeLost: false }

/** A completed large temple gives its manna once per player, unless one was lost after completion before. */
completions.push((ctx, b) => {
  const r = ctx.rules.religion
  if (!r || ruleOf(ctx, b).temple !== 'large') return
  const religion = religionOf(ctx.state.players.find(p => p.id === b.owner)!)
  if (religion.templeLost) return
  religion.manna += r.completionManna; religion.produced += r.completionManna
  b.nextResident = ctx.state.tick + r.priestTicks
  emit(ctx, { player: b.owner, type: 'manna', text: `The large temple pleased Jupiter: ${r.completionManna} manna`, entity: b.id })
})

/** Losing a completed large temple ends what further large temples give, so building and razing them earns nothing. */
export function templeLost(ctx: Context, b: Building): void {
  if (ctx.rules.religion && ruleOf(ctx, b).temple === 'large' && b.phase === 'active') religionOf(ctx.state.players.find(p => p.id === b.owner)!).templeLost = true
}

/** The religion pass for one tick: small temples take offerings, large temples bring priests. */
export function worship(ctx: Context): void {
  const r = ctx.rules.religion
  if (!r) return
  for (const b of [...ctx.state.buildings.values()].sort((a, c) => a.id - c.id)) {
    const temple = ruleOf(ctx, b).temple
    if (b.phase !== 'active' || !temple || b.suspended) continue
    if (temple === 'small') {
      // The cycle counter holds the ticks until the next offering may be taken.
      if (b.cycle > 0) { b.cycle--; continue }
      const stack = slot(ctx, b, 'input', r.offering, ruleOf(ctx, b).inputs[r.offering]!)
      if (stack.amount - stack.reservedOut < 1) continue
      stack.amount--
      record(ctx, b.owner, 'consumed', r.offering, 1)
      const religion = religionOf(ctx.state.players.find(p => p.id === b.owner)!)
      religion.manna++; religion.produced++
      b.cycle = r.offerTicks
      continue
    }
    // A large temple: a priest arrives on its schedule, up to the limit; residents counts those it brought.
    if (b.residents >= r.priestLimit || ctx.state.tick < b.nextResident) continue
    if (spawn(ctx, b.owner, r.priest, doorOf(ctx, b), 'birth')) { b.residents++; b.nextResident = ctx.state.tick + r.priestTicks; emit(ctx, { player: b.owner, type: 'priest', text: 'A priest arrived at the large temple', entity: b.id }) }
  }
}

/** The manna the next promotion costs, or null when every class has reached the highest rank. */
export function promotionCost(ctx: Context, player: Player): number | null {
  const r = ctx.rules.religion
  if (!r) return null
  // Reading never creates religion state, so views and observations leave the world untouched.
  return r.promotions[player.religion?.promotions ?? 0] ?? null
}

/**
 * Promotes one soldier class: soldiers recruited afterwards start a rank higher.
 * No class may get two ranks ahead of another (reference MannaInformation).
 */
export function promote(ctx: Context, player: Player, profession: string): string | null {
  const r = ctx.rules.religion, military = ctx.rules.military
  if (!r || !military) return 'These rules have no promotions.'
  if (!ctx.profession.get(profession)?.soldier) return 'Only soldiers can be promoted.'
  const religion = religionOf(player), level = religion.levels[profession] ?? 0
  if (level >= military.ranks - 1) return `${profession} soldiers already join at the highest rank.`
  const classes = ctx.rules.professions.filter(p => p.soldier).map(p => p.id)
  if (classes.some(c => (religion.levels[c] ?? 0) < level)) return 'Promote the other soldier classes to this rank first.'
  const cost = promotionCost(ctx, player)!
  if (religion.manna < cost) return `A promotion needs ${cost} manna; you have ${religion.manna}.`
  religion.manna -= cost; religion.promotions++
  religion.levels[profession] = level + 1
  emit(ctx, { player: player.id, type: 'promotion', text: `New ${profession} soldiers will join at rank ${level + 2}` })
  return null
}
