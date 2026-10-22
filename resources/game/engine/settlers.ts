import type { Context } from './context'
import type { Op, Program, Settler } from './state'
import { ledger, nextId, occupy, passable, pointAt, tileOf, vacate } from './context'
import { directionBetween, neighbours, pointOf } from './geometry'
import { enterable, route, stepCost } from './routing'

export type Effect = (ctx: Context, s: Settler, args: Record<string, number | string>) => boolean
export type Finish = (ctx: Context, s: Settler, program: Program, ok: boolean, reason: string | null) => void
/** Effects and completion handlers are registered by systems, keyed by plain names so programs stay serializable. */
export const effects = new Map<string, Effect>()
export const finishers = new Map<string, Finish>()

// Occupancy model (engineering decision, S3-027): settlers pass each other while
// walking, as crowds do on the original screen, but every resting settler holds
// a distinct tile. A settler that stops on a held tile steps to the nearest free
// one, so resting crowds never stack and placement can see who stands where.

/** Nearest free passable tile around a point, searched breadth-first for a stable result. */
export function freeTileNear(ctx: Context, tile: number, owner = 0, limit = 400): number | null {
  const seen = new Set([tile]), queue = [tile]
  for (let i = 0; i < queue.length && i < limit; i++) {
    const at = queue[i]!
    if (passable(ctx, at) && ctx.index.settlerAt[at] === 0 && (!owner || ctx.state.map.owner[at] === owner || ctx.state.map.owner[at] === 0)) return at
    for (const next of neighbours(ctx.state.map, at)) if (!seen.has(next)) { seen.add(next); queue.push(next) }
  }
  return null
}

export function spawn(ctx: Context, owner: number, profession: string, near: number, reason: 'birth' | 'scenario'): Settler | null {
  // Specialists and soldiers are not bound to their territory, so they may arrive outside it.
  const tile = freeTileNear(ctx, near, ctx.profession.get(profession)?.specialist ? 0 : owner)
  if (tile === null) return null
  const p = pointAt(ctx, tile)
  const s: Settler = { id: nextId(ctx), owner, profession, tool: null, x: p.x, y: p.y, dir: 3, action: 'idle', next: -1, path: [], step: 0, stepTicks: 0, waited: 0, retries: 0, holding: false, cargo: null, program: null, workplace: 0, inside: 0, diagnostic: null }
  ctx.state.settlers.set(s.id, s)
  occupy(ctx, s, tile)
  if (reason === 'birth') ledger(ctx, owner).births++
  return s
}

export function changeProfession(ctx: Context, s: Settler, profession: string): void {
  if (s.profession === profession) return
  s.profession = profession
  ledger(ctx, s.owner).transitions++
}

// Systems share one call shape; starting a program needs no context today.
// eslint-disable-next-line pickier/no-unused-vars
export function start(ctx: Context, s: Settler, kind: string, ref: number, steps: Op[]): void {
  s.program = { kind, ref, steps, pc: 0 }
  s.path = []; s.waited = 0; s.retries = 0; s.diagnostic = null
  if (s.action === 'working') s.action = 'idle'
}

/** Ends the active program and hands the outcome to the registered owner. */
export function finish(ctx: Context, s: Settler, ok: boolean, reason: string | null): void {
  const program = s.program
  if (!program) return
  s.program = null; s.path = []; s.waited = 0; s.retries = 0
  if (s.action === 'working' || s.action === 'waiting') s.action = 'idle'
  if (!ok) s.diagnostic = reason
  finishers.get(program.kind)?.(ctx, s, program, ok, reason)
}

const civilian = (ctx: Context, s: Settler): boolean => !ctx.profession.get(s.profession)?.specialist

function plan(ctx: Context, s: Settler, op: Extract<Op, { op: 'go' }>): boolean {
  const result = route(ctx, tileOf(ctx, s), op.tile, { adjacent: op.adjacent, territory: civilian(ctx, s) ? s.owner : 0 })
  if (!result.ok) { finish(ctx, s, false, result.reason); return false }
  s.path = result.path
  return true
}

function arrived(ctx: Context, s: Settler, op: Extract<Op, { op: 'go' }>): boolean {
  const here = tileOf(ctx, s)
  if (here === op.tile) return true
  return !!op.adjacent && neighbours(ctx.state.map, op.tile).includes(here)
}

/** Advances one settler by one tick: movement first, then its program, then resting placement. */
export function tickSettler(ctx: Context, s: Settler): void {
  if (s.action === 'walking') {
    if (++s.step < s.stepTicks) return
    const p = pointOf(ctx.state.map, s.next)
    s.x = p.x; s.y = p.y; s.action = 'idle'; s.next = -1; s.step = 0; s.stepTicks = 0
  }
  runProgram(ctx, s)
  if (!s.program && !s.inside && s.action === 'idle') rest(ctx, s)
}

function rest(ctx: Context, s: Settler): void {
  const tile = tileOf(ctx, s), holder = ctx.index.settlerAt[tile]!
  if (holder === s.id) return
  if (holder === 0 && passable(ctx, tile)) { occupy(ctx, s, tile); return }
  const free = freeTileNear(ctx, tile, civilian(ctx, s) ? s.owner : 0)
  if (free !== null) start(ctx, s, 'settle', 0, [{ op: 'go', tile: free }])
}

function runProgram(ctx: Context, s: Settler): void {
  // Several instantaneous operations may complete in one tick; bound them so a malformed program cannot spin.
  for (let budget = 0; budget < 8 && s.program; budget++) {
    const op = s.program.steps[s.program.pc]
    if (!op) { finish(ctx, s, true, null); return }
    if (op.op === 'go') {
      if (s.inside) { finish(ctx, s, false, 'inside'); return }
      if (arrived(ctx, s, op)) { s.path = []; s.program.pc++; continue }
      if (!s.path.length && !plan(ctx, s, op)) return
      walk(ctx, s, op)
      return
    }
    if (op.op === 'work') {
      if (s.action !== 'working') { s.action = 'working'; s.step = 0; if (!s.inside) occupy(ctx, s, tileOf(ctx, s)) }
      if (++s.step < op.ticks) return
      s.action = s.inside ? 'inside' : 'idle'; s.step = 0; s.program.pc++
      return
    }
    if (op.op === 'do') {
      const effect = effects.get(op.effect)
      if (!effect) { finish(ctx, s, false, `unknown effect ${op.effect}`); return }
      const program = s.program
      if (!effect(ctx, s, op.args ?? {})) { if (s.program === program) finish(ctx, s, false, `${op.effect} failed`); return }
      // An effect may replace the program (an equipped carrier continues to its new duty).
      if (s.program === program) s.program.pc++
      continue
    }
    if (op.op === 'enter') {
      if (!ctx.state.buildings.has(op.building)) { finish(ctx, s, false, 'building missing'); return }
      if (!s.inside) vacate(ctx, s, tileOf(ctx, s))
      s.inside = op.building; s.action = 'inside'; s.program.pc++
      continue
    }
    if (op.op === 'leave') {
      if (s.inside) { s.inside = 0; s.action = 'idle' }
      s.program.pc++
      continue
    }
  }
}

function walk(ctx: Context, s: Settler, op: Extract<Op, { op: 'go' }>): void {
  const from = tileOf(ctx, s), next = s.path[0]!
  if (!enterable(ctx, next, civilian(ctx, s) ? s.owner : 0, op.tile) || stepCost(ctx, from, next) === Infinity) {
    // The world changed under a cached path: plan again from here rather than walking through it.
    s.path = []
    if (plan(ctx, s, op) && s.path.length) walk(ctx, s, op)
    return
  }
  vacate(ctx, s, from)
  s.path.shift()
  s.next = next; s.action = 'walking'; s.step = 0
  s.stepTicks = stepCost(ctx, from, next)
  s.dir = directionBetween(pointOf(ctx.state.map, from), pointOf(ctx.state.map, next)) ?? s.dir
}
