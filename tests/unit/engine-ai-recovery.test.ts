import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, restore, save, createSession, describeMap, diagnose, economicAI, findStart, generateMap, observe, PUBLISHED_RULES, stepAI } from '../../resources/game/engine'
import { anchors, landscape, order, place, rules } from '../fixtures/engine'
import { RIVAL_MILITARY } from '../../resources/game/controller'

type Placed = { type: string, x: number, y: number }
const carriers = (n: number) => Array.from({ length: n }, (_, i) => ({ profession: 'carrier', x: 36 + (i % 8), y: 47 + Math.floor(i / 8) }))
/** A computer settlement made of scenario buildings and loose piles, so each test sets up exactly one deadlock. */
function computer(buildings: Placed[], piles: { good: string, amount: number }[] = [], settlers = carriers(16), map = landscape()): Session {
  const s = createSession({
    rules, map, seed: 3,
    players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }, ...buildings], settlers } }],
    piles: piles.map((p, i) => ({ ...p, x: 38 + (i % 4), y: 51 + Math.floor(i / 4) })),
  })
  expect(s.skipped).toEqual({})
  return s
}
const play = (s: Session, ticks: number, ai = economicAI(1, { interval: 20 }), seq = { next: 0 }): typeof ai => {
  for (let t = 0; t < ticks; t++) { stepAI(s, ai, seq); s.advance(1) }
  return ai
}
const mine = (s: Session) => s.state.results.filter(r => r.player === 1)

describe('AI deadlock recovery', () => {
  test('the captured normal seed-3 deadlock restores stone production and finishes both waiting sites', async () => {
    const bytes = await Bun.file(new URL('../fixtures/ai-seed3-stone-bootstrap.json', import.meta.url)).arrayBuffer()
    expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe('1b4676a8bf291ece7d63cf49aae71e3338f3c978cb2f6639dce8b488bb5087e6')
    const s = restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
    expect(s.state.tick).toBe(60000)
    const before = s.state.ledger[2]!.produced.stone!, created = { ...s.state.ledger[2]!.created }
    expect(before).toBe(72)
    expect([1430, 1497].every(id => s.state.buildings.get(id)?.phase === 'building')).toBe(true)
    const ai = economicAI(2, { military: RIVAL_MILITARY })
    const sequence = { next: 1 + Math.max(-1, ...s.state.pending.filter(c => c.player === 2).map(c => c.seq), ...s.state.results.filter(c => c.player === 2).map(c => c.seq)) }
    const completed = new Set<number>()
    for (let tick = 0; tick < 10000 && (completed.size < 2 || (s.state.ledger[2]!.produced.stone ?? 0) <= before); tick++) {
      stepAI(s, ai, sequence); s.advance(1)
      // An exhausted fisher can legitimately be removed after it completed.
      for (const id of [1430, 1497]) if (s.state.buildings.get(id)?.phase === 'active') completed.add(id)
    }
    expect(s.state.ledger[2]!.produced.stone!).toBeGreaterThan(before)
    expect(s.state.ledger[2]!.created).toEqual(created)
    expect([...completed].sort((a, b) => a - b)).toEqual([1430, 1497])
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60000)

  test('stone production is bootstrapped from real refunds while two material-starved sites occupy the limit', () => {
    const s = computer([{ type: 'woodcutter', x: 49, y: 51 }, { type: 'sawmill', x: 31, y: 44 }, { type: 'waterworks', x: 47, y: 32 }], [
      { good: 'plank', amount: 24 }, { good: 'stone', amount: 8 }, { good: 'log', amount: 16 }, { good: 'axe', amount: 2 }, { good: 'saw', amount: 1 },
      { good: 'hammer', amount: 4 }, { good: 'shovel', amount: 4 }, { good: 'pickaxe', amount: 2 },
    ])
    const house = place(s, 'medium-residence', { x: 36, y: 54 })
    s.advance(3000)
    expect(s.state.buildings.get(house)?.phase).toBe('active')
    const a = place(s, 'coal-mine', { x: 28, y: 28 }), b = place(s, 'fisher', { x: 52, y: 38 })
    s.advance(3000)
    expect([a, b].every(id => s.state.buildings.get(id)?.phase === 'building')).toBe(true)
    expect(s.view(1).stacks.filter(stack => stack.good === 'stone').reduce((n, stack) => n + stack.amount, 0)).toBe(0)
    expect(diagnose(observe(s, 1))).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'materials', recovery: { type: 'demolish', building: expect.any(Number) }, recoverable: true })]))
    const before = s.state.ledger[1]!.created.stone ?? 0
    const ai = play(s, 18000)
    expect(s.state.ledger[1]!.created.stone ?? 0).toBe(before)
    expect(s.state.ledger[1]!.recovered.stone ?? 0).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.produced.stone ?? 0).toBeGreaterThan(0)
    expect([a, b].every(id => s.state.buildings.get(id)?.phase === 'active')).toBe(true)
    expect(ai.results).toEqual([])
    expect(mine(s).filter(result => !result.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60000)

  test('a surveyor explores the visible frontier after surveying the known mountains without reading hidden ore', () => {
    const field = (hiddenGood: string) => {
      const map = describeMap(rules, { width: 96, height: 96, seed: 5, base: 'grass', features: [
        { kind: 'terrain', id: 'mountain', x: 28, y: 28, radius: 3 },
        { kind: 'resource', id: 'coal', x: 28, y: 28, radius: 3, amount: 2 },
        { kind: 'terrain', id: 'mountain', x: 80, y: 42, radius: 4 },
        { kind: 'resource', id: hiddenGood, x: 80, y: 42, radius: 4, amount: 3 },
      ] })
      const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [
        { good: 'plank', amount: 20 }, { good: 'stone', amount: 20 }, { good: 'hammer', amount: 2 }, { good: 'saw', amount: 1 },
      ], [...carriers(16), { profession: 'geologist', x: 28, y: 28 }], map)
      order(s, 'specialists', { profession: 'geologist', x: 28, y: 28, count: 1 })
      s.advance(3000)
      expect(s.view(1).settlers.find(p => p.profession === 'geologist')?.diagnostic).toBe('duty complete')
      expect(s.view(1).signs.some(sign => sign.good === 'coal')).toBe(true)
      return s
    }
    const s = field('ironore'), other = field('goldore'), ai = economicAI(1), before = s.view(1).explored.reduce((sum, seen) => sum + seen, 0)
    const observed = observe(s, 1), decisions = ai.decide(observed)
    expect(observed.explored(42 * 96 + 80)).toBe(false)
    expect(decisions).toEqual(economicAI(1).decide(observe(other, 1)))
    const survey = decisions.find(command => command.type === 'specialists' && command.profession === 'geologist')
    expect(survey).toBeDefined()
    const target = survey as { x: number, y: number }
    expect(observed.explored(target.y * 96 + target.x)).toBe(true)
    order(s, 'specialists', { profession: 'geologist', ...target, count: 1 })
    s.advance(800)
    expect(s.view(1).explored.reduce((sum, seen) => sum + seen, 0)).toBeGreaterThan(before)
    expect(audit(s.context)).toEqual([])
  })

  test('a discovered neutral iron deposit is claimed by a real pioneer and supplied to a constructed mine', () => {
    const map = landscape([
      { kind: 'terrain', id: 'mountain', x: 73, y: 42, radius: 5 },
      { kind: 'resource', id: 'ironore', x: 73, y: 42, radius: 5, amount: 3 },
    ])
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [
      { good: 'plank', amount: 40 }, { good: 'stone', amount: 40 }, { good: 'hammer', amount: 2 }, { good: 'saw', amount: 1 },
      { good: 'shovel', amount: 2 }, { good: 'pickaxe', amount: 2 }, { good: 'bread', amount: 16 },
    ], [...carriers(16), { profession: 'geologist', x: 64, y: 40 }], map)
    order(s, 'specialists', { profession: 'geologist', x: 68, y: 40, count: 1 })
    for (let tick = 0; tick < 1000 && !s.view(1).signs.some(sign => sign.good === 'ironore'); tick++) s.advance(1)
    const sign = s.view(1).signs.find(sign => sign.good === 'ironore')!
    expect(sign).toBeDefined()
    expect(s.view(1).owner[sign.tile]).toBe(0)
    const ai = economicAI(1, { interval: 20 })
    expect(ai.decide(observe(s, 1)).some(command => command.type === 'specialists' && command.profession === 'pioneer')).toBe(true)
    let pioneerClaimed = false
    const sequence = { next: 1 }
    for (let tick = 0; tick < 16000; tick++) {
      stepAI(s, ai, sequence); s.advance(1)
      if (s.state.events.some(event => event.type === 'territory' && event.text === 'A pioneer claimed new land' && event.tile === sign.tile)) pioneerClaimed = true
    }
    expect(pioneerClaimed).toBe(true)
    expect(s.view(1).owner[sign.tile]).toBe(1)
    expect(s.view(1).buildings.some(b => b.type === 'iron-mine' && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[1]!.produced.ironore ?? 0).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.equipped.shovel ?? 0).toBeGreaterThan(0)
    expect(ai.results).toEqual([])
    expect(mine(s).filter(result => !result.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('a surveyor explores known neutral mountains when the settlement has no mountain land', () => {
    const map = describeMap(rules, { width: 96, height: 96, seed: 5, base: 'grass', features: [
      { kind: 'terrain', id: 'mountain', x: 73, y: 42, radius: 5 },
      { kind: 'resource', id: 'ironore', x: 73, y: 42, radius: 5, amount: 3 },
    ] })
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [
      { good: 'plank', amount: 10 }, { good: 'stone', amount: 12 }, { good: 'hammer', amount: 2 }, { good: 'saw', amount: 1 },
    ], [...carriers(16), { profession: 'geologist', x: 64, y: 40 }], map)
    const o = observe(s, 1), ai = economicAI(1, { interval: 20 })
    expect(o.view.explored.some((seen, tile) => seen === 1 && o.view.owner[tile] === 0 && o.terrain(tile) === 'mountain')).toBe(true)
    const survey = ai.decide(o).find(command => command.type === 'specialists')
    expect(survey).toBeDefined()
    const target = survey as { x: number, y: number }, tile = target.y * o.width + target.x
    expect(o.view.owner[tile]).toBe(0)
    expect(o.explored(tile)).toBe(true)
    expect(o.terrain(tile)).toBe('mountain')
    play(s, 3000, ai)
    expect(s.view(1).signs.some(sign => sign.good === 'ironore' && sign.amount > 0)).toBe(true)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('an idle failed geologist is reassigned to a mountain outside known building footprints without equipping a second specialist', () => {
    const map = describeMap(rules, { width: 96, height: 96, seed: 5, base: 'grass', features: [
      { kind: 'terrain', id: 'mountain', x: 15, y: 15, radius: 7 },
      { kind: 'resource', id: 'coal', x: 15, y: 15, radius: 7, amount: 2 },
    ] })
    const s = computer([{ type: 'coal-mine', x: 22, y: 22 }, { type: 'sawmill', x: 31, y: 44 }], [
      { good: 'plank', amount: 10 }, { good: 'stone', amount: 12 }, { good: 'hammer', amount: 2 }, { good: 'saw', amount: 1 },
    ], [...carriers(16), { profession: 'geologist', x: 30, y: 40 }], map)
    order(s, 'specialists', { profession: 'geologist', x: 22, y: 22, count: 1 })
    const geologist = s.view(1).settlers.find(p => p.profession === 'geologist')!
    expect(geologist.diagnostic).toBe('unreachable')
    expect(geologist.busy).toBe(false)
    const ai = economicAI(1, { interval: 20 })
    const survey = ai.decide(observe(s, 1)).find(command => command.type === 'specialists')
    expect(survey).toBeDefined()
    const next = survey as { x: number, y: number }
    const rule = rules.buildings.find(b => b.id === 'coal-mine')!
    expect(rule.footprint.some(([dx, dy]) => next.x === 22 + dx && next.y === 22 + dy)).toBe(false)
    play(s, 4000, ai, { next: 1 })
    expect(s.view(1).signs.length).toBeGreaterThan(0)
    expect(s.view(1).settlers.filter(p => p.profession === 'geologist').map(p => p.id)).toEqual([geologist.id])
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('the rival keeps its exhausted woodcutter while a forester finishes and timber production resumes after restore', async () => {
    // The recorded seed-2 checkpoint pins the actual failure independently of later AI planning changes.
    const bytes = await Bun.file(new URL('../fixtures/ai-woodcutter-pending-forester.json', import.meta.url)).arrayBuffer()
    expect(Bun.SHA256.hash(bytes, 'hex')).toBe('e15e9413bf7f49b038214fc8f925017e8d93ffcc1a8bf3dab8103ba56e159d36')
    const checkpoint = JSON.parse(new TextDecoder().decode(bytes))
    const s = restore(checkpoint, PUBLISHED_RULES), ai = economicAI(2, { military: RIVAL_MILITARY })
    const sequence = { next: Math.max(0, ...s.state.pending.filter(command => command.player === 2).map(command => command.seq + 1), ...s.state.results.filter(result => result.player === 2).map(result => result.seq + 1)) }
    const cutter = s.view(2).buildings.find(b => b.owner === 2 && b.type === 'woodcutter' && b.shortage === 'no-resources')!
    expect(cutter).toBeDefined()
    expect(s.view(2).buildings.some(b => b.owner === 2 && b.type === 'forester' && b.phase === 'building')).toBe(true)
    const produced = s.state.ledger[2]!.produced.plank ?? 0
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    const restoredAI = economicAI(2, { military: RIVAL_MILITARY }), restoredSequence = { next: sequence.next }
    for (let tick = 0; tick < 4000; tick++) {
      stepAI(s, ai, sequence); s.advance(1)
      stepAI(copy, restoredAI, restoredSequence); copy.advance(1)
    }
    expect(s.view(2).buildings.some(b => b.id === cutter.id && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[2]!.produced.plank ?? 0).toBeGreaterThan(produced)
    expect(copy.checksum()).toBe(s.checksum())
    expect(ai.results).toEqual([])
    expect(restoredAI.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('forestry recovery follows the actual working areas instead of a distant forester', () => {
    const map = describeMap(rules, { width: 96, height: 96, base: 'grass', seed: 5, features: [] })
    const s = computer([{ type: 'woodcutter', x: 53, y: 51 }, { type: 'forester', x: 31, y: 44 }], [{ good: 'axe', amount: 1 }], carriers(16), map)
    s.advance(600)
    const cutter = s.view(1).buildings.find(b => b.type === 'woodcutter')!
    const forester = s.view(1).buildings.find(b => b.type === 'forester')!
    expect(cutter.shortage).toBe('no-resources')
    expect(diagnose(observe(s, 1)).find(d => d.building === cutter.id)).toMatchObject({ kind: 'exhausted', recovery: { type: 'demolish', building: cutter.id } })
    order(s, 'work-area', { building: forester.id, x: 49, y: 44 })
    expect(diagnose(observe(s, 1)).find(d => d.building === cutter.id)).toMatchObject({ kind: 'exhausted', recovery: null })
    expect(audit(s.context)).toEqual([])
  })

  test('a missing tool becomes an urgent order, so the tool smith makes it before anything else', () => {
    const first = (withAI: boolean): string => {
      const s = computer([{ type: 'toolsmith', x: 31, y: 44 }, { type: 'woodcutter', x: 53, y: 51 }], [{ good: 'iron', amount: 4 }, { good: 'coal', amount: 4 }, { good: 'hammer', amount: 1 }])
      for (let t = 0; t < 4000 && !Object.keys(s.state.ledger[1]!.produced).some(g => rules.tools.includes(g)); t++) {
        if (withAI) stepAI(s, ai, seq)
        s.advance(1)
      }
      return Object.keys(s.state.ledger[1]!.produced).find(g => rules.tools.includes(g)) ?? ''
    }
    const ai = economicAI(1, { interval: 20 }), seq = { next: 0 }
    expect(first(false)).not.toBe('axe')
    expect(first(true)).toBe('axe')
  }, 60_000)

  test('a stonecutter whose granite is gone is torn down for its refund; a woodcutter beside a forester waits', () => {
    const s = computer([{ type: 'stonecutter', x: 30, y: 31 }, { type: 'woodcutter', x: 53, y: 51 }, { type: 'forester', x: 44, y: 54 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'pickaxe', amount: 1 }, { good: 'axe', amount: 1 }, { good: 'shovel', amount: 1 }])
    // No granite anywhere: the stonecutter can only report that nothing is left.
    const stone = rules.objects.findIndex(o => o.id === 'stone') + 1, tree = rules.objects.findIndex(o => o.id === 'tree') + 1
    for (let t = 0; t < s.state.map.object.length; t++) { if (s.state.map.object[t] === stone || s.state.map.object[t] === tree) { s.state.map.object[t] = 0; s.state.map.objectAmount[t] = 0 } }
    const ai = play(s, 1200)
    expect(mine(s).some(r => r.type === 'demolish' && r.ok)).toBe(true)
    expect([...s.state.buildings.values()].some(b => b.type === 'stonecutter' && b.x === 30 && b.y === 31)).toBe(false)
    expect(s.state.ledger[1]!.recovered.plank).toBeGreaterThan(0)
    expect([...s.state.buildings.values()].some(b => b.type === 'woodcutter' && b.x === 53)).toBe(true)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('a hungry mine cannot recover when there is no hammer, builder or equipped tool smith', () => {
    const s = computer([{ type: 'coal-mine', x: 28, y: 28 }, { type: 'sawmill', x: 31, y: 44 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'pickaxe', amount: 1 }])
    for (let t = 0; t < 3000 && !diagnose(observe(s, 1)).some(d => d.kind === 'food'); t++) s.advance(1)
    const ai = play(s, 1200)
    expect(ai.diagnosis).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'food', recoverable: false }),
      expect.objectContaining({ kind: 'tool', recoverable: false }),
    ]))
    expect(mine(s).filter(r => r.type === 'build')).toEqual([])
    expect(s.state.ledger[1]!.produced).toEqual({})
    expect(audit(s.context)).toEqual([])
  })

  test('hungry miners receive actual fish and resume extraction after the AI completes a fisher', () => {
    const s = computer([{ type: 'coal-mine', x: 28, y: 28 }, { type: 'sawmill', x: 31, y: 44 }], [
      { good: 'plank', amount: 16 }, { good: 'stone', amount: 20 }, { good: 'pickaxe', amount: 1 },
      { good: 'hammer', amount: 2 }, { good: 'shovel', amount: 2 }, { good: 'saw', amount: 1 }, { good: 'fishingrod', amount: 1 }, { good: 'axe', amount: 2 },
    ])
    for (let t = 0; t < 3000 && !diagnose(observe(s, 1)).some(d => d.kind === 'food'); t++) s.advance(1)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'food' && d.recoverable)).toBe(true)
    const ai = economicAI(1, { interval: 20 }), seq = { next: 0 }
    for (let t = 0; t < 8000 && !(s.state.ledger[1]!.produced.coal ?? 0); t++) { stepAI(s, ai, seq); s.advance(1) }
    expect(s.view(1).buildings.some(b => b.type === 'fisher' && b.phase === 'active' && b.worker)).toBe(true)
    expect(s.state.ledger[1]!.produced.fish ?? 0).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.consumed.fish ?? 0).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.produced.coal ?? 0).toBeGreaterThan(0)
    expect(ai.results).toEqual([])
    expect(mine(s).filter(r => !r.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('a carrier shortage is relieved by actual births and worker assignment from a completed residence', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }, { type: 'woodcutter', x: 49, y: 51 }], [
      { good: 'plank', amount: 16 }, { good: 'stone', amount: 20 }, { good: 'saw', amount: 1 }, { good: 'axe', amount: 2 },
    ], [...carriers(2), { profession: 'builder', x: 39, y: 50 }])
    s.enqueue({ tick: 0, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 70 } })
    for (let t = 0; t < 600 && !diagnose(observe(s, 1)).some(d => d.kind === 'population'); t++) s.advance(1)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'population' && d.recoverable)).toBe(true)
    const ai = economicAI(1, { interval: 20 }), seq = { next: 1 }
    for (let t = 0; t < 8000 && !(s.state.ledger[1]!.produced.log ?? 0); t++) { stepAI(s, ai, seq); s.advance(1) }
    expect(s.view(1).buildings.some(b => b.type === 'small-residence' && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[1]!.births).toBeGreaterThan(0)
    expect(s.view(1).population).toBe(3 + s.state.ledger[1]!.births)
    expect(s.view(1).buildings.find(b => b.type === 'woodcutter' && b.x === 49)!.worker).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.produced.log ?? 0).toBeGreaterThan(0)
    expect(ai.results).toEqual([])
    expect(mine(s).filter(r => !r.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('zero settlers and no residence cannot bootstrap construction by ordering another residence', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'saw', amount: 1 }], [])
    s.advance(1)
    const ai = play(s, 1200)
    expect(ai.diagnosis).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'population', recoverable: false, recovery: null })]))
    expect(mine(s).filter(r => r.type === 'build')).toEqual([])
    expect(s.view(1).population).toBe(0)
    expect(audit(s.context)).toEqual([])
  })

  test('builders without carriers or future residents cannot deliver a residence into existence', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'log', amount: 8 }], [{ profession: 'builder', x: 39, y: 50 }])
    const ai = play(s, 1200)
    expect(ai.diagnosis).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'population', recoverable: false })]))
    expect(mine(s).filter(r => r.type === 'build')).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('with no planks or logs left, idle buildings are torn down to pay for a sawmill', () => {
    const s = computer([{ type: 'woodcutter', x: 49, y: 51 }, { type: 'medium-residence', x: 31, y: 44 }, { type: 'small-residence', x: 36, y: 54 }], [{ good: 'stone', amount: 8 }, { good: 'axe', amount: 1 }, { good: 'saw', amount: 1 }, { good: 'hammer', amount: 2 }, { good: 'shovel', amount: 2 }])
    const d = diagnose(observe(s, 1)).find(d => d.kind === 'materials')!
    expect(d).toMatchObject({ recoverable: true, recovery: { type: 'demolish' } })
    expect(s.state.buildings.get((d.recovery as { building: number }).building)!.type).toBe('medium-residence')
    const ai = play(s, 6000)
    expect([...s.state.buildings.values()].some(b => b.type === 'sawmill' && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(0)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 120_000)

  test('with no planks, logs or refunds left the economy is recognised as unrecoverable and no sites are ordered', () => {
    const s = computer([], [{ good: 'stone', amount: 8 }])
    const ai = play(s, 400)
    expect(ai.diagnosis).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'materials', recoverable: false, recovery: null })]))
    expect(mine(s).filter(r => r.type === 'build')).toEqual([])
  })

  test('delivery recovers after its storage site is cancelled, with identical mid-recovery save replay', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [
      { good: 'log', amount: 40 }, { good: 'saw', amount: 1 }, { good: 'plank', amount: 16 }, { good: 'stone', amount: 20 },
      { good: 'hammer', amount: 2 }, { good: 'shovel', amount: 2 },
    ])
    for (let t = 0; t < 12000 && !diagnose(observe(s, 1)).some(d => d.kind === 'delivery'); t++) s.advance(1)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'delivery')).toBe(true)
    const ai = economicAI(1, { interval: 20 }), seq = { next: 0 }
    for (let t = 0; t < 40 && !s.view(1).buildings.some(b => b.type === 'storage'); t++) { stepAI(s, ai, seq); s.advance(1) }
    const site = s.view(1).buildings.find(b => b.type === 'storage')!
    expect(site.phase).not.toBe('active')
    s.enqueue({ tick: s.state.tick, player: 1, seq: seq.next++, type: 'demolish', building: site.id })
    s.advance(1)
    expect(s.view(1).buildings.some(b => b.id === site.id)).toBe(false)
    play(s, 100, ai, seq)
    const produced = s.state.ledger[1]!.produced.plank ?? 0
    const restored = restore(save(s), rules), fresh = economicAI(1, { interval: 20 }), seqB = { next: seq.next }
    for (let t = 0; t < 6000; t++) {
      stepAI(s, ai, seq); s.advance(1)
      stepAI(restored, fresh, seqB); restored.advance(1)
      if (t % 100 === 0) { expect(audit(s.context)).toEqual([]); expect(audit(restored.context)).toEqual([]) }
    }
    expect(checksum(restored.state)).toBe(checksum(s.state))
    expect(s.view(1).buildings.some(b => b.type === 'storage' && b.phase === 'active')).toBe(true)
    expect(s.view(1).stacks.some(st => st.role === 'storage' && st.good === 'plank' && st.amount > 0)).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(produced)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'delivery')).toBe(false)
    expect(mine(s).filter(r => !r.ok)).toEqual([])
    expect(ai.results).toEqual([])
    expect(fresh.results).toEqual([])
  })

  test('an idle geologist returns its actual hammer so construction and plank production can resume', () => {
    const s = computer([{ type: 'woodcutter', x: 49, y: 51 }], [
      { good: 'plank', amount: 8 }, { good: 'stone', amount: 12 }, { good: 'axe', amount: 2 }, { good: 'saw', amount: 1 }, { good: 'shovel', amount: 2 },
    ], [...carriers(16), { profession: 'geologist', x: 39, y: 50 }])
    const created = s.state.ledger[1]!.created.hammer
    s.enqueue({ tick: 0, player: 1, seq: 0, type: 'dismiss', profession: 'builder', count: 1 })
    s.advance(1)
    expect(mine(s).at(-1)).toMatchObject({ ok: false, reason: 'Malformed order to return specialists.' })
    const ai = economicAI(1, { interval: 20 }), seq = { next: 1 }
    for (let t = 0; t < 6000 && !(s.state.ledger[1]!.produced.plank ?? 0); t++) { stepAI(s, ai, seq); s.advance(1) }
    expect(mine(s).some(r => r.type === 'dismiss' && r.ok)).toBe(true)
    expect(s.state.ledger[1]!.recovered.hammer ?? 0).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.created.hammer).toBe(created)
    expect(s.view(1).buildings.some(b => b.type === 'sawmill' && b.phase === 'active' && b.worker)).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(0)
    expect(ai.results).toEqual([])
    expect(mine(s).filter(r => r.seq > 0 && !r.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('returning an idle pioneer supplies a real carrier for a residence and its new workers', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [
      { good: 'plank', amount: 12 }, { good: 'stone', amount: 12 }, { good: 'log', amount: 12 }, { good: 'saw', amount: 1 },
    ], [{ profession: 'builder', x: 39, y: 50 }, { profession: 'pioneer', x: 38, y: 50 }])
    const ai = economicAI(1, { interval: 20 }), seq = { next: 0 }
    for (let t = 0; t < 8000 && !(s.state.ledger[1]!.produced.plank ?? 0); t++) { stepAI(s, ai, seq); s.advance(1) }
    expect(mine(s).some(r => r.type === 'dismiss' && r.ok)).toBe(true)
    expect(s.state.ledger[1]!.births).toBeGreaterThan(0)
    expect(s.view(1).population).toBe(2 + s.state.ledger[1]!.births)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(0)
    expect(mine(s).filter(r => !r.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('a surveyor keeps its hammer until the supplied tool smith can make a replacement', () => {
    const s = computer([{ type: 'woodcutter', x: 49, y: 51 }, { type: 'sawmill', x: 23, y: 50 }, { type: 'toolsmith', x: 31, y: 44 }], [
      { good: 'iron', amount: 4 }, { good: 'coal', amount: 4 }, { good: 'plank', amount: 8 }, { good: 'stone', amount: 12 },
      { good: 'axe', amount: 2 }, { good: 'saw', amount: 1 }, { good: 'shovel', amount: 2 },
    ], [...carriers(16), { profession: 'builder', x: 39, y: 50 }, { profession: 'geologist', x: 38, y: 50 }])
    s.advance(1)
    expect(diagnose(observe(s, 1)).some(d => d.recovery?.type === 'dismiss')).toBe(false)
    const ai = economicAI(1, { interval: 20 }), seq = { next: 0 }
    for (let t = 0; t < 6000 && !(s.state.ledger[1]!.produced.hammer ?? 0); t++) { stepAI(s, ai, seq); s.advance(1) }
    expect(mine(s).some(r => r.type === 'dismiss' && r.ok)).toBe(true)
    expect(s.state.ledger[1]!.produced.hammer ?? 0).toBeGreaterThan(0)
    expect(mine(s).filter(r => !r.ok)).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('a hammer on a surveying geologist is awaited and reclaimed after duty, not declared lost', () => {
    const s = computer([{ type: 'woodcutter', x: 49, y: 51 }], [
      { good: 'plank', amount: 8 }, { good: 'stone', amount: 12 }, { good: 'axe', amount: 2 }, { good: 'saw', amount: 1 }, { good: 'shovel', amount: 2 },
    ], [...carriers(16), { profession: 'geologist', x: 39, y: 50 }])
    s.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 28, y: 28, count: 1 })
    s.advance(1)
    expect(s.view(1).settlers.find(s => s.profession === 'geologist')!.action).toBe('walking')
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'tool' && !d.recoverable)).toBe(false)
    const ai = economicAI(1, { interval: 20 }), seq = { next: 1 }
    for (let t = 0; t < 8000 && !(s.state.ledger[1]!.produced.plank ?? 0); t++) { stepAI(s, ai, seq); s.advance(1) }
    expect(mine(s).some(r => r.type === 'dismiss' && r.ok)).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(0)
    expect(mine(s).filter(r => !r.ok)).toEqual([])
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  })

  test('remaining residence arrivals are an owned observation and repeated reads do not change the simulation', () => {
    const s = computer([{ type: 'small-residence', x: 36, y: 54 }], [], [])
    const before = checksum(s.state), count = rules.buildings.find(b => b.id === 'small-residence')!.residents!.count
    expect(s.view(1).buildings.find(b => b.type === 'small-residence')!.residentsRemaining).toBe(count)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'population' && !d.recoverable)).toBe(false)
    expect(checksum(s.state)).toBe(before)
    s.advance(2000)
    expect(s.view(1).buildings.find(b => b.type === 'small-residence')!.residentsRemaining).toBe(0)
    expect(s.view(1).population).toBe(count)
    expect(audit(s.context)).toEqual([])
  })

  test('bootstrap observations expose own availability and arrivals without concealed enemy work state', () => {
    const s = createSession({ rules, map: landscape(), seed: 3, players: [
      { name: 'Computer', civilization: 'roman', controller: 'computer', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'small-residence', x: 36, y: 54 }], settlers: [{ profession: 'carrier', x: 64, y: 43 }] } },
      { name: 'Other', civilization: 'roman', start: { x: 75, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 75, y: 40 }, { type: 'small-residence', x: 67, y: 44 }], settlers: [{ profession: 'carrier', x: 68, y: 44 }] } },
    ], piles: [{ good: 'hammer', amount: 1, x: 38, y: 51 }, { good: 'hammer', amount: 1, x: 66, y: 41 }] })
    expect(s.skipped).toEqual({})
    const before = checksum(s.state), view = s.view(1)
    expect(view.buildings.find(b => b.owner === 1 && b.type === 'small-residence')!.residentsRemaining).toBeGreaterThan(0)
    expect(view.buildings.find(b => b.owner === 2 && b.type === 'small-residence')).toBeDefined()
    expect(view.buildings.filter(b => b.owner === 2).every(b => !('residentsRemaining' in b))).toBe(true)
    expect(view.stacks.find(st => st.owner === 1)!.available).toBe(1)
    expect(view.stacks.find(st => st.owner === 2)).toBeDefined()
    expect(view.stacks.filter(st => st.owner === 2).every(st => !('available' in st))).toBe(true)
    expect(view.settlers.find(p => p.owner === 1)!.busy).toBe(false)
    expect(view.settlers.find(p => p.owner === 2)).toBeDefined()
    expect(view.settlers.filter(p => p.owner === 2).every(p => !('busy' in p))).toBe(true)
    expect(checksum(s.state)).toBe(before)
  })

  test('a removed sawmill is rebuilt, so the supply of planks recovers', () => {
    const map = generateMap(rules, 96, 96, 21), start = findStart(rules, map, { x: 48, y: 48 }, 10)!
    const s = createSession({ rules, map, seed: 21, players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start }] })
    const ai = economicAI(1), seq = { next: 0 }
    const run = (ticks: number): void => { for (let t = 0; t < ticks; t++) { stepAI(s, ai, seq); s.advance(1) } }
    run(8000)
    const sawmill = [...s.state.buildings.values()].find(b => b.type === 'sawmill' && b.phase === 'active')!
    expect(sawmill).toBeDefined()
    // The supply route is cut through the same command a player would use.
    s.enqueue({ tick: s.state.tick, player: 1, seq: seq.next++, type: 'demolish', building: sawmill.id })
    run(1)
    const planks = s.state.ledger[1]!.produced.plank ?? 0
    run(10_000)
    expect([...s.state.buildings.values()].some(b => b.type === 'sawmill' && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(planks)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 180_000)
})
