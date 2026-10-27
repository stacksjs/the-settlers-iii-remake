import type { Context } from './context'
import type { InterventionRule } from './rules'
import type { Effect, Player, Settler } from './state'
import { changed, emit, ledger, passable, pointAt, prune, record, tileOf } from './context'
import { terrainIs } from './landscapes'
import { area, distance } from './geometry'
import { dropToGround } from './logistics'
import { NO_ORDER } from './military'
import { randomInt } from './random'
import { religionOf } from './religion'
import { finishers, halt, start } from './settlers'

// Divine interventions (manual: Jupiter's Acts of Divine Intervention). A
// priest is ordered to cast at a tile; those that need him present walk until
// he is within casting distance. Manna is checked and spent when the spell is
// cast, and each use raises the next cost by a tenth of the base.

const intervention = (ctx: Context, id: string): InterventionRule | undefined => ctx.rules.religion?.interventions?.find(i => i.id === id)

/** The manna an intervention costs a player now. */
export function interventionCost(ctx: Context, player: Player, id: string): number | null {
  const rule = intervention(ctx, id)
  if (!rule) return null
  const uses = player.religion?.casts?.[id] ?? 0
  return Math.floor(rule.manna * (uses + 10) / 10)
}

export const active = (s: Settler, kind: Effect['kind'], tick: number): Effect | undefined => s.effects?.find(e => e.kind === kind && e.until > tick)

/** Orders a priest to cast. Returns a rejection reason or null. Any new order replaces the previous one. */
export function orderCast(ctx: Context, player: Player, value: Record<string, unknown>): string | null {
  const religion = ctx.rules.religion
  if (!religion?.interventions) return 'These rules have no divine interventions.'
  const priest = ctx.state.settlers.get(value.priest as number)
  if (!priest || priest.owner !== player.id || priest.profession !== religion.priest) return 'Choose one of your priests.'
  const rule = intervention(ctx, value.spell as string)
  if (!rule) return 'Unknown intervention.'
  const { x, y } = value
  if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= ctx.state.map.width || (y as number) >= ctx.state.map.height) return 'Choose a tile on the map.'
  priest.cast = { spell: rule.id, tile: tileOf(ctx, { x: x as number, y: y as number }) }
  if (priest.program?.kind === 'pilgrimage') priest.program = null
  return null
}

finishers.set('pilgrimage', (ctx, s, _program, ok, reason) => {
  // A priest who cannot reach the place gives up the order instead of trying forever.
  if (ok || !s.cast) return
  emit(ctx, { player: s.owner, type: 'spell-failed', text: `A priest could not reach the place of the intervention: ${reason ?? 'blocked'}`, entity: s.id })
  delete s.cast
})

/** The interventions pass for one tick: expire effects and eyes, then let ordered priests walk or cast. */
export function intervene(ctx: Context): void {
  const religion = ctx.rules.religion
  if (!religion?.interventions) return
  const { state } = ctx
  if (state.eyes?.length) state.eyes = state.eyes.filter(e => e.until > state.tick)
  for (const s of [...state.settlers.values()].sort((a, c) => a.id - c.id)) {
    if (s.effects) { s.effects = s.effects.filter(e => e.until > state.tick); if (!s.effects.length) delete s.effects }
    if (!s.cast || s.inside) continue
    const rule = intervention(ctx, s.cast.spell)
    if (!rule) { delete s.cast; continue }
    const target = pointAt(ctx, s.cast.tile)
    if (!rule.presence || distance(s, target) <= religion.castDistance!) {
      if (s.action === 'walking') { s.path = []; continue }
      s.program = null; halt(s)
      cast(ctx, s, rule, s.cast.tile)
      delete s.cast
      continue
    }
    if (!s.program) start(ctx, s, 'pilgrimage', s.cast.tile, [{ op: 'go', tile: s.cast.tile, adjacent: !passable(ctx, s.cast.tile) }])
  }
}

function cast(ctx: Context, priest: Settler, rule: InterventionRule, tile: number): void {
  const { state } = ctx, player = state.players.find(p => p.id === priest.owner)!
  const faith = religionOf(player), cost = interventionCost(ctx, player, rule.id)!
  if (faith.manna < cost) { emit(ctx, { player: player.id, type: 'spell-failed', text: `${rule.name} needs ${cost} manna; you have ${faith.manna}`, entity: priest.id }); return }
  faith.manna -= cost
  ;(faith.casts ??= {})[rule.id] = (faith.casts[rule.id] ?? 0) + 1
  const target = pointAt(ctx, tile), seconds = (rule.seconds ?? 0) * ctx.rules.tickRate
  // Area effects reach the nearest first, measured from the priest, as the reference sorts them.
  const near = (tiles: number[]): number[] => tiles.sort((a, b) => distance(pointAt(ctx, a), priest) - distance(pointAt(ctx, b), priest) || a - b)
  const people = (test: (s: Settler) => boolean): Settler[] => [...state.settlers.values()].filter(s => !s.inside && distance(s, target) <= rule.radius && test(s))
    .sort((a, b) => distance(a, priest) - distance(b, priest) || a.id - b.id).slice(0, rule.limit ?? Infinity)
  let detail = ''
  switch (rule.id) {
    case 'magic-eye':
      (state.eyes ??= []).push({ player: player.id, tile, radius: rule.radius, until: state.tick + seconds })
      break
    case 'grassland-galore': {
      const to = ctx.terrain.findIndex(t => t.id === rule.to)
      let n = 0
      for (const t of area(state.map, target, rule.radius)) if (terrainIs(ctx.terrain[state.map.terrain[t]!]!, rule.from!)) { state.map.terrain[t] = to; changed(ctx, t); n++ }
      if (n) state.navigation++
      detail = `${n} tiles of desert became grassland`
      break
    }
    case 'gorgeous-growth':
      for (const s of people(s => s.owner === player.id && ['farmer', 'winegrower', 'forester'].includes(s.profession))) (s.effects ??= []).push({ kind: 'growth', until: state.tick + seconds, caster: player.id })
      break
    case 'festering-fear':
      for (const s of people(s => s.owner !== player.id && !!s.soldier)) (s.effects ??= []).push({ kind: 'fear', until: state.tick + seconds, caster: player.id })
      break
    case 'heavenly-presents': {
      const piles = randomInt(state.random, rule.limit! + 1)
      const spots = area(state.map, target, rule.radius).filter(t => passable(ctx, t) && ctx.index.protectedAt[t] === 0 && (state.map.owner[t] === 0 || state.map.owner[t] === player.id))
      let n = 0
      for (const t of spots.slice(0, piles)) {
        const good = ctx.rules.goods[randomInt(state.random, ctx.rules.goods.length)]!, size = randomInt(state.random, rule.amount! + 1)
        if (!size) continue
        const placed = size - dropToGround(ctx, player.id, t, good, size)
        if (placed) { record(ctx, player.id, 'created', good, placed); n += placed }
      }
      detail = n ? `${n} goods fell from the sky` : 'the sky stayed empty this time'
      break
    }
    case 'midas-touch': {
      let taken = 0
      for (const t of near(area(state.map, target, rule.radius))) {
        for (const st of [...state.stacks.values()].filter(st => st.tile === t && st.owner === player.id && st.good === rule.from && st.role !== 'input' && st.role !== 'construction')) {
          const n = Math.min(st.amount - st.reservedOut, rule.limit! - taken)
          if (n > 0) { st.amount -= n; taken += n; prune(ctx, st) }
        }
      }
      if (taken) {
        record(ctx, player.id, 'consumed', rule.from!, taken)
        const left = dropToGround(ctx, player.id, tile, rule.to!, taken)
        record(ctx, player.id, 'produced', rule.to!, taken - left)
      }
      detail = `${taken} iron became gold`
      break
    }
    case 'vanishing-resources': {
      for (const t of area(state.map, target, rule.radius)) {
        if (state.map.owner[t] === player.id || !terrainIs(ctx.terrain[state.map.terrain[t]!]!, 'mountain') || !state.map.resourceAmount[t]) continue
        state.map.resourceAmount[t] = Math.floor(state.map.resourceAmount[t]! * rule.percent! / 100)
        if (!state.map.resourceAmount[t]) state.map.resource[t] = 0
        changed(ctx, t)
      }
      break
    }
    case 'conversion': {
      const won = people(s => s.owner !== player.id && !!s.soldier)
      for (const s of won) {
        ledger(ctx, s.owner).left = (ledger(ctx, s.owner).left ?? 0) + 1
        ledger(ctx, player.id).joined = (ledger(ctx, player.id).joined ?? 0) + 1
        emit(ctx, { player: s.owner, type: 'converted', text: `A ${s.profession} went over to ${player.name}`, entity: s.id })
        s.owner = player.id
        s.program = null; halt(s)
        const soldier = s.soldier!
        soldier.order = NO_ORDER; soldier.attack = 0; soldier.garrison = 0
        delete soldier.route; delete soldier.patrol; delete soldier.forced
        delete s.effects
      }
      detail = `${won.length} soldiers were converted`
      break
    }
  }
  emit(ctx, { player: player.id, type: 'intervention', text: `${rule.name}${detail ? `: ${detail}` : ''}`, tile })
}
