import { describe, expect, test } from 'bun:test'
import { checksum, createSession, PUBLISHED_RULES, SAVE_VERSION, describeMap, generateMap, pick, qualificationGaps, record, restore, rulesIdentity, save, SaveError, toView, validateRules, verify } from '../../resources/game/engine'
import { area, distance, DIRECTIONS, fromView, indexOf, neighbours } from '../../resources/game/engine/geometry'
import { passable } from '../../resources/game/engine/context'
import { sha256 } from '../../resources/game/engine/hash'
import { nextRandom, randomInt, seedRandom } from '../../resources/game/engine/random'
import { route } from '../../resources/game/engine/routing'
import { start } from '../../resources/game/engine/settlers'
import prototypeSave from '../fixtures/prototype-save.json'
import formatOneSave from '../fixtures/save-format-1.json'
import { anchors, building, landscape, order, place, rules, run, session, site, until } from '../fixtures/engine'

describe('rules catalog', () => {
  test('the Roman engineering profile validates and has a stable identity', () => {
    expect(validateRules(rules)).toBe(rules)
    const a = rulesIdentity(rules), b = rulesIdentity(structuredClone(rules))
    expect(a).toEqual(b)
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(rules.buildings.find(b => b.id === 'sawmill')!.cost).toEqual({ plank: 3, stone: 4 })
  })
  test('any change to the rules changes the profile version', () => {
    // Saves name rules by id, version and digest. Changing a value without a new version would make
    // older saves fail with a message that names the version they already have.
    const pinned: Record<string, string> = { '0.2.0': 'a9a1cb0bd34fa08f3b498738fdae7fbc1f04173c627e7f6ee3824248678578c7', '0.3.0': '0a78e27ff86cf37e81f103b08120395ae59301bef207bb21b2c209eed1e0af72', '0.4.0': 'd6c3ceadf21aaccfd4bc23f4883bc5474d8e97935a483a4c53cdf23f33fccc52', '0.5.0': '1db4df3c6b1eab90b50195423f465abddd83ba74f48dacebf9a61650b2eaf966' }
    expect(rulesIdentity(rules).digest).toBe(pinned[rules.version]!)
  })
  test('rejects duplicated, dangling, contradictory and unevidenced definitions', () => {
    const broken = structuredClone(rules)
    broken.buildings.push({ ...broken.buildings[0]!, cost: { plank: 1 } })
    broken.buildings[1]!.worker = 'astronaut'
    broken.professions[0]!.tool = 'laser'
    broken.objects.push({ id: 'oak', blocks: true, amount: 1, grows: { into: 'missing', ticks: 10 } })
    delete broken.evidence['buildings.woodcutter.cost']; delete broken.evidence['buildings.woodcutter.geometry']; delete broken.evidence['buildings.woodcutter.timing']
    broken.evidence.survey = { class: 'U', source: 'x', note: 'y' }
    let problems: string[] = []
    try { validateRules(broken) }
    catch (error) { problems = (error as { problems: string[] }).problems }
    expect(problems.some(p => p.includes('defined more than once'))).toBe(true)
    expect(problems.some(p => p.includes('unknown profession astronaut'))).toBe(true)
    expect(problems.some(p => p.includes('unknown tool laser'))).toBe(true)
    expect(problems.some(p => p.includes('grows into invalid missing'))).toBe(true)
    expect(problems.some(p => p.includes('buildings.woodcutter has no evidence'))).toBe(true)
    expect(problems.some(p => p.includes('must name its owning issue'))).toBe(true)
  })
  test('an original profile cannot carry placeholders, and the engineering profile never qualifies a release', () => {
    expect(() => validateRules({ ...structuredClone(rules), fidelity: 'original' })).toThrow('original profile cannot rely on U evidence')
    const gaps = qualificationGaps(rules)
    expect(gaps.length).toBeGreaterThan(20)
    expect(gaps.some(g => g.startsWith('tickRate: U'))).toBe(true)
  })
})

describe('deterministic primitives', () => {
  test('sha256 matches the standard vectors', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('a'.repeat(1000))).toBe(new Bun.CryptoHasher('sha256').update('a'.repeat(1000)).digest('hex'))
  })
  test('seeded randomness repeats exactly and rejects invalid bounds', () => {
    const a = seedRandom(42), b = seedRandom(42), c = seedRandom(43)
    const sa = Array.from({ length: 50 }, () => nextRandom(a)), sb = Array.from({ length: 50 }, () => nextRandom(b))
    expect(sa).toEqual(sb)
    expect(Array.from({ length: 50 }, () => nextRandom(c))).not.toEqual(sa)
    const counts = [0, 0, 0]
    for (let i = 0; i < 3000; i++) counts[randomInt(a, 3)]!++
    expect(Math.min(...counts)).toBeGreaterThan(850)
    expect(() => randomInt(a, 0)).toThrow()
    expect(() => seedRandom(1.5)).toThrow()
  })
  test('the lattice has six neighbours, symmetric distances and invertible projection', () => {
    const bounds = { width: 20, height: 20 }
    expect(neighbours(bounds, indexOf(bounds, 5, 5))).toHaveLength(6)
    expect(neighbours(bounds, 0)).toHaveLength(3)
    for (const [dx, dy] of DIRECTIONS) expect(distance({ x: 5, y: 5 }, { x: 5 + dx, y: 5 + dy })).toBe(1)
    expect(distance({ x: 0, y: 0 }, { x: 3, y: -2 })).toBe(5)
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(3)
    expect(area(bounds, { x: 5, y: 5 }, 1)).toHaveLength(7)
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) { const v = toView(x, y); expect(fromView(v.x, v.y)).toEqual({ x, y }) }
  })
  test('picking round-trips across elevations', () => {
    // Slopes stay within the steepest climb settlers can walk, as on playable original terrain.
    const map = describeMap(rules, { width: 40, height: 40, base: 'grass', features: [{ kind: 'elevation', x: 20, y: 20, radius: 10, amount: 20 }, { kind: 'elevation', x: 8, y: 30, radius: 5, amount: 10 }] })
    let elevated = 0
    for (let y = 2; y < 38; y++) {
      for (let x = 2; x < 38; x++) {
        const h = map.elevation[indexOf(map, x, y)]!
        if (h) elevated++
        const v = toView(x, y, h)
        expect(pick(map, v.x, v.y)).toEqual({ x, y })
      }
    }
    expect(elevated).toBeGreaterThan(300)
  })
})

describe('routing', () => {
  test('routes around buildings and water, and reports unreachable goals within a bounded search', () => {
    const s = session()
    const ctx = s.context, map = s.state.map
    const castle = building(s, 'castle')!
    const from = indexOf(map, castle.x - 12, castle.y), to = indexOf(map, castle.x + 11, castle.y)
    const result = route(ctx, from, to)
    expect(result.ok).toBe(true)
    if (result.ok) for (const t of result.path) expect(ctx.index.buildingAt[t]).toBe(0)
    const island = describeMap(rules, { width: 48, height: 48, base: 'grass', features: [{ kind: 'terrain', id: 'water', x: 34, y: 34, radius: 6 }, { kind: 'terrain', id: 'grass', x: 34, y: 34, radius: 1 }] })
    const isolated = createSession({ rules, map: island, seed: 1, players: [{ name: 'A', civilization: 'roman', start: { x: 12, y: 12 } }] })
    const blocked = route(isolated.context, indexOf(island, 2, 45), indexOf(island, 34, 34))
    expect(blocked).toMatchObject({ ok: false, reason: 'unreachable' })
    // The search ends once every reachable tile is exhausted rather than looping.
    expect(blocked.expanded).toBeLessThanOrEqual(48 * 48)
    expect(route(isolated.context, indexOf(island, 2, 45), indexOf(island, 46, 46), { limit: 5 })).toMatchObject({ ok: false, reason: 'search-limit' })
  })
  test('settlers walk all six directions as individuals, and re-route when the world changes mid-trip', () => {
    const s = session()
    const ctx = s.context, map = s.state.map
    const walker = [...s.state.settlers.values()].find(p => p.profession === 'carrier')!
    const id = walker.id
    // Walk a hexagon: one step in each lattice direction returns to the start.
    const origin = anchors.west
    start(ctx, walker, 'test', 0, [{ op: 'go', tile: indexOf(map, origin.x, origin.y) }])
    until(s, () => !walker.program, 400)
    const seen = new Set<number>()
    for (const [dx, dy] of DIRECTIONS) {
      const goal = { x: walker.x + dx, y: walker.y + dy }
      start(ctx, walker, 'test', 0, [{ op: 'go', tile: indexOf(map, goal.x, goal.y) }])
      until(s, () => !walker.program, 100)
      expect({ x: walker.x, y: walker.y }).toEqual(goal)
      seen.add(walker.dir)
    }
    expect(seen.size).toBe(6)
    expect({ x: walker.x, y: walker.y }).toEqual(origin)
    expect(s.state.settlers.get(id)).toBe(walker)
    // Start a long walk, then block the next tiles on its path with planted trees.
    const goal = indexOf(map, anchors.south.x, anchors.south.y)
    start(ctx, walker, 'test', 0, [{ op: 'go', tile: goal }])
    s.advance(1)
    const blocked = walker.path.slice(1, 3)
    for (const t of blocked) { map.object[t] = ctx.objectIndex.get('tree')!; map.objectAmount[t] = 1 }
    s.state.navigation++
    let previous = { x: walker.x, y: walker.y }
    until(s, () => {
      // Every move is a single lattice step: no teleporting around the obstacle.
      expect(distance(previous, walker)).toBeLessThanOrEqual(1)
      previous = { x: walker.x, y: walker.y }
      return !walker.program
    }, 600)
    expect(indexOf(map, walker.x, walker.y)).toBe(goal)
    for (const t of blocked) expect(indexOf(map, walker.x, walker.y) === t).toBe(false)
  })
  test('an unreachable destination ends the walk with a diagnostic instead of retrying forever', () => {
    const s = session({ map: landscape([{ kind: 'terrain', id: 'water', x: 80, y: 80, radius: 4 }, { kind: 'terrain', id: 'grass', x: 80, y: 80, radius: 0 }]) })
    const walker = [...s.state.settlers.values()][0]!
    const before = { x: walker.x, y: walker.y }
    start(s.context, walker, 'test', 0, [{ op: 'go', tile: indexOf(s.state.map, 80, 80) }])
    s.advance(2)
    expect(walker.program).toBeNull()
    expect(walker.diagnostic).toBe('unreachable')
    expect({ x: walker.x, y: walker.y }).toEqual(before)
  })
})

describe('session commands and determinism', () => {
  const script = (s: ReturnType<typeof session>): void => {
    place(s, 'woodcutter', anchors.forest)
    place(s, 'stonecutter', anchors.granite)
    place(s, 'forester', anchors.south)
  }
  test('identical commands and seeds give identical state at every tick', () => {
    const a = session(), b = session()
    script(a); script(b)
    for (let i = 0; i < 60; i++) { a.advance(25); b.advance(25); expect(checksum(a.state)).toBe(checksum(b.state)) }
    expect(building(a, 'woodcutter')!.phase).toBe('active')
  }, 30_000)
  test('render timing does not change the simulation', () => {
    const a = session(), b = session()
    script(a); script(b)
    a.advance(1200)
    for (let i = 0; i < 1200;) { const n = 1 + (i * 7) % 13; b.advance(Math.min(n, 1200 - i)); i += n; b.view(1) }
    expect(checksum(a.state)).toBe(checksum(b.state))
  }, 30_000)
  test('commands execute in tick, player and sequence order regardless of arrival', () => {
    const a = session(), b = session()
    const commands = [
      { tick: 5, player: 1, seq: 2, type: 'build', building: 'stonecutter', ...site(a, 'stonecutter', anchors.granite) },
      { tick: 5, player: 1, seq: 1, type: 'build', building: 'woodcutter', ...site(a, 'woodcutter', anchors.forest) },
      { tick: 3, player: 1, seq: 9, type: 'settings', settings: { carrierRatio: 40 } },
    ]
    for (const c of commands) expect(a.enqueue(c)).toBeNull()
    for (const c of [...commands].reverse()) expect(b.enqueue(c)).toBeNull()
    a.advance(10); b.advance(10)
    expect(checksum(a.state)).toBe(checksum(b.state))
    expect(a.state.results.map(r => r.seq)).toEqual([9, 1, 2])
  })
  test('malformed, late, duplicate and foreign commands are refused without changing state', () => {
    const s = session()
    s.advance(10)
    const before = checksum(s.state)
    expect(s.enqueue({ tick: 2, player: 1, seq: 1, type: 'build', building: 'woodcutter', x: 15, y: 21 })?.reason).toContain('current tick')
    expect(s.enqueue({ tick: 10, player: 3, seq: 1, type: 'build' })?.ok).toBe(false)
    expect(s.enqueue({ tick: 10, player: 1, seq: 1, type: 'teleport' })?.reason).toBe('Unknown command.')
    expect(s.enqueue({ tick: 10, player: 1, seq: 1, type: 'build', building: 'x'.repeat(5000), x: 1, y: 1 })?.reason).toContain('too large')
    expect(checksum(s.state)).toBe(before)
    expect(s.enqueue({ tick: 10, player: 1, seq: 7, type: 'build', building: 'woodcutter', x: 999, y: 1 })).toBeNull()
    expect(s.enqueue({ tick: 10, player: 1, seq: 7, type: 'build', building: 'woodcutter', x: 1, y: 1 })?.reason).toContain('Duplicate')
    expect(s.enqueue({ tick: 10, player: 1, seq: 8, type: 'demolish', building: 999999 })).toBeNull()
    s.advance(1)
    expect(s.state.results.slice(-2).map(r => [r.ok, r.reason])).toEqual([[false, 'Malformed build order.'], [false, 'That building is not yours.']])
    expect(s.state.buildings.size).toBe(1)
  })
  test('disposed sessions refuse further use', () => {
    const s = session()
    s.dispose()
    expect(() => s.advance(1)).toThrow('disposed')
    expect(() => s.view(1)).toThrow('disposed')
  })
})

describe('player views', () => {
  test('foreign settlers and buildings appear only where the player currently sees', () => {
    const map = generateMap(rules, 96, 64, 4)
    for (const [x, y] of [[20, 30], [76, 30]] as const) for (const t of area(map, { x, y }, 11)) { map.terrain[t] = 0; map.object[t] = 0; map.elevation[t] = 0 }
    for (let x = 10; x < 90; x++) for (let y = 28; y < 33; y++) { const t = indexOf(map, x, y); map.terrain[t] = 0; map.object[t] = 0; map.elevation[t] = 0 }
    const s = createSession({ rules, map, seed: 9, players: [{ name: 'A', civilization: 'roman', start: { x: 20, y: 30 } }, { name: 'B', civilization: 'roman', start: { x: 76, y: 30 } }] })
    const view = s.view(1)
    expect(view.settlers.every(p => p.owner === 1)).toBe(true)
    expect(view.buildings.every(b => b.owner === 1)).toBe(true)
    expect(view.stacks.every(st => st.owner === 1)).toBe(true)
    const explored = view.explored.reduce((a, b) => a + b, 0)
    expect(explored).toBeGreaterThan(100)
    expect(view.explored[indexOf(map, 76, 30)]).toBe(0)
    expect(view.owner[indexOf(map, 76, 30)]).toBe(0)
    // A pioneer walks east until the rival castle is in sight.
    // Target open land beside the rival castle's door.
    const rival = [...s.state.buildings.values()].find(b => b.owner === 2)!
    const door = indexOf(map, rival.x + rules.buildings.find(r => r.id === 'castle')!.door[0], rival.y + rules.buildings.find(r => r.id === 'castle')!.door[1])
    const target = area(map, { x: door % map.width, y: Math.floor(door / map.width) }, 3).find(t => passable(s.context, t))!
    order(s, 'specialists', { profession: 'pioneer', x: target % map.width, y: Math.floor(target / map.width), count: 1 })
    const pioneer = [...s.state.settlers.values()].find(p => p.owner === 1 && p.profession === 'pioneer')!
    until(s, () => { const v = s.view(1); return v.settlers.some(p => p.owner === 2) && v.buildings.some(b => b.owner === 2) }, 4000, false)
    const seen = s.view(1)
    expect(seen.settlers.some(p => p.owner === 2)).toBe(true)
    for (const foreign of seen.settlers.filter(p => p.owner === 2)) expect(foreign.diagnostic).toBeNull()
    expect(seen.buildings.find(b => b.owner === 2)!.shortage).toBeNull()
    // Without its pioneer the player loses sight again but keeps the explored map.
    if (pioneer.holding) s.context.index.settlerAt[indexOf(map, pioneer.x, pioneer.y)] = 0
    s.state.settlers.delete(pioneer.id)
    s.advance(rules.visibility.interval)
    const later = s.view(1)
    expect(later.settlers.some(p => p.owner === 2)).toBe(false)
    expect(later.explored[target]).toBe(1)
  })
})

const formatOne = formatOneSave as unknown as ReturnType<typeof save>

describe('saves and replays', () => {
  test('a mid-delivery save restores the exact state and continues identically', () => {
    const a = session()
    order(a, 'build', { building: 'woodcutter', ...site(a, 'woodcutter', anchors.forest) })
    until(a, () => [...a.state.jobs.values()].some(j => j.kind === 'deliver' && j.picked), 200)
    const envelope = save(a)
    const b = restore(JSON.parse(JSON.stringify(envelope)), rules)
    expect(checksum(b.state)).toBe(checksum(a.state))
    for (let i = 0; i < 30; i++) { a.advance(20); b.advance(20); expect(checksum(b.state)).toBe(checksum(a.state)) }
    expect(building(b, 'woodcutter')!.phase).toBe('active')
  })
  test('refuses prototype, foreign, newer, mismatched and damaged saves with specific reasons', () => {
    const s = session(), envelope = save(s)
    const code = (value: unknown): string => { try { restore(value, rules); return 'restored' } catch (error) { return error instanceof SaveError ? error.code : `other: ${(error as Error).message}` } }
    // A Riverlands prototype save captured from the retired browser prototype.
    expect(code(prototypeSave)).toBe('prototype-save')
    expect(code({ hello: 'world' })).toBe('not-a-save')
    expect(code('not json')).toBe('not-a-save')
    expect(code({ ...envelope, version: 99 })).toBe('newer-version')
    expect(code({ ...envelope, rules: { ...envelope.rules, digest: '0'.repeat(64) } })).toBe('incompatible-rules')
    expect(code({ ...envelope, checksum: 'deadbeef' })).toBe('damaged')
    const mutate = (change: (e: typeof envelope) => void): string => { const copy = structuredClone(envelope); change(copy); return code(copy) }
    expect(mutate(e => { e.state.map.layers.terrain = e.state.map.layers.terrain.slice(8) })).toBe('damaged')
    expect(mutate(e => { e.state.settlers[1]!.id = e.state.settlers[0]!.id })).toBe('damaged')
    expect(mutate(e => { e.state.settlers[0]!.x = 1e9 })).toBe('damaged')
    expect(mutate(e => { e.state.stacks[0]!.amount = -1 })).toBe('damaged')
    expect(mutate(e => { e.state.stacks[0]!.building = 123456 })).toBe('damaged')
    expect(mutate(e => { e.state.settlers[0]!.program = { kind: 'x', ref: 0, steps: Array.from({ length: 40 }, () => ({ op: 'leave' as const })), pc: 0 } })).toBe('damaged')
    expect(mutate(e => { e.state.map.width = 4096 })).toBe('damaged')
    expect(mutate(e => { e.state.players[0]!.settings.transportPriority = ['plank'] })).toBe('damaged')
    expect(mutate(e => { (e.state as { random: number[] }).random = [0, 0, 0, 0] })).toBe('damaged')
    expect(code(JSON.stringify(envelope))).toBe('restored')
  })
  test('format 1 saves are verified under their own checksum, then migrated to the current format', () => {
    // Written by the engine at 7b1cc36, before saves carried mission progress, with the frozen 0.2.0 rules.
    const restored = restore(structuredClone(formatOne), PUBLISHED_RULES)
    expect(restored.state.mission).toBeNull()
    expect(restored.state.tick).toBe(formatOne.tick)
    expect(restored.state.buildings.size).toBe(2)
    restored.advance(100)
    const current = save(restored)
    expect(current.version).toBe(SAVE_VERSION)
    expect(checksum(restore(JSON.parse(JSON.stringify(current)), PUBLISHED_RULES).state)).toBe(checksum(restored.state))
    const tampered = structuredClone(formatOne)
    tampered.state.settlers[0]!.x += 1
    expect(() => restore(tampered, PUBLISHED_RULES)).toThrow('checksum does not match')
  })
  test('replays verify across a restored runtime and report the first divergent tick', () => {
    const s = session(), recorder = record(s)
    let seq = 0
    const send = (type: string, fields: Record<string, unknown>): void => { expect(recorder.enqueue({ tick: s.state.tick, player: 1, seq: seq++, type, ...fields })).toBeNull() }
    send('build', { building: 'woodcutter', ...site(s, 'woodcutter', anchors.forest) })
    recorder.advance(120)
    send('build', { building: 'stonecutter', ...site(s, 'stonecutter', anchors.granite) })
    recorder.advance(300)
    const replay = recorder.replay()
    expect(verify(JSON.parse(JSON.stringify(replay)), rules)).toMatchObject({ ok: true, ticks: 420, checksum: checksum(s.state) })
    const changed = structuredClone(replay)
    changed.commands[1]!.x = (changed.commands[1]!.x as number) + 1
    const divergent = verify(changed, rules)
    expect(divergent).toMatchObject({ ok: false, reason: 'divergence', tick: 120 })
    const corrupted = structuredClone(replay)
    corrupted.checksums[250] = '00000000'
    expect(verify(corrupted, rules)).toMatchObject({ ok: false, tick: 250 })
  }, 60_000)
  test('a long mixed economy keeps goods conserved and survives saves at arbitrary ticks', () => {
    const s = session()
    place(s, 'woodcutter', anchors.forest)
    place(s, 'stonecutter', anchors.granite)
    place(s, 'forester', anchors.south)
    place(s, 'sawmill', anchors.north)
    for (let round = 0; round < 6; round++) {
      run(s, 700)
      const copy = restore(save(s), rules)
      copy.advance(97); s.advance(97)
      expect(checksum(copy.state)).toBe(checksum(s.state))
    }
    expect(s.state.ledger[1]!.produced.log ?? 0).toBeGreaterThan(0)
    expect(s.state.ledger[1]!.produced.stone ?? 0).toBeGreaterThan(0)
  }, 60_000)
})

test('saves keep the rules they were made with after the profile moves on', async () => {
  const { PUBLISHED_RULES, rulesFor } = await import('../../resources/game/engine')
  // Format 1 saves were written with the published 0.2.0 profile, which the catalog keeps frozen.
  const fixture = (await import('../fixtures/save-format-1.json')).default as unknown as { rules: { id: string, version: string, digest: string } }
  const frozen = rulesFor(fixture.rules)
  expect(frozen?.version).toBe('0.2.0')
  const restored = restore(structuredClone(fixture), PUBLISHED_RULES)
  expect(restored.rules).toBe(frozen!)
  expect(() => restore(structuredClone(fixture), [rules].filter(r => r.version !== '0.2.0'))).toThrow()
})
