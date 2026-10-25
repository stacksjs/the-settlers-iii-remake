import type { PlayerSetup, Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, PUBLISHED_RULES, restore, save } from '../../resources/game/engine'
import { strength } from '../../resources/game/engine/military'
import { anchors, building, landscape, order, place, rules, run, until } from '../fixtures/engine'

const soldiers = (s: Session, owner: number, profession?: string) => [...s.state.settlers.values()].filter(p => p.owner === owner && p.soldier && (!profession || p.profession === profession))
const scenario = (settlers: { profession: string, x: number, y: number }[], buildings: { type: string, x: number, y: number }[] = []): PlayerSetup['scenario'] => ({ buildings, settlers })

function field(p1: { profession: string, x: number, y: number }[], p2: { profession: string, x: number, y: number }[], p1Buildings: { type: string, x: number, y: number }[] = []): Session {
  return createSession({
    rules, map: landscape(), seed: 1,
    players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: scenario(p1, p1Buildings) },
      { name: 'Enemy', civilization: 'roman', start: anchors.castle, scenario: scenario(p2) },
    ],
  })
}

describe('recruitment', () => {
  test('waiting recruitment orders can be reduced without changing soldiers or goods, including after restore', () => {
    const s = field([{ profession: 'swordsman', x: 40, y: 70 }], [])
    order(s, 'recruit', { profession: 'swordsman', count: 3 })
    order(s, 'recruit', { profession: 'bowman', count: 2 })
    const population = s.view(1).population, goods = s.view(1).goods
    order(s, 'cancel-recruit', { profession: 'swordsman', count: 1 })
    expect(s.state.players[0]!.settings.recruit!.queue).toEqual({ swordsman: 2, bowman: 2 })
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    for (const session of [s, copy]) {
      expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 1000, type: 'cancel-recruit', profession: 'swordsman', count: 2 })).toBeNull()
      session.advance(1)
      expect(session.state.results.at(-1)!.ok).toBe(true)
      expect(session.state.players[0]!.settings.recruit!.queue).toEqual({ bowman: 2 })
      expect(session.view(1).population).toBe(population)
      expect(session.view(1).goods).toEqual(goods)
      expect(soldiers(session, 1, 'swordsman')).toHaveLength(1)
      expect(audit(session.context)).toEqual([])
    }
    expect(checksum(copy.state)).toBe(checksum(s.state))
  })

  test('barracks turn carriers into soldiers with delivered weapons, keeping rank and accounting', () => {
    const s = createSession({ rules, map: landscape(), seed: 3, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { plank: 30, stone: 30, sword: 2, bow: 1 } }] })
    const barracks = place(s, 'barracks', anchors.west)
    until(s, () => s.state.buildings.get(barracks)!.phase === 'active', 6000)
    const carriersBefore = [...s.state.settlers.values()].filter(p => p.profession === 'carrier').length
    order(s, 'recruit', { profession: 'swordsman', count: 1 })
    order(s, 'recruit', { profession: 'pikeman', count: 1 })
    until(s, () => soldiers(s, 1, 'swordsman').length === 1, 3000)
    const first = soldiers(s, 1, 'swordsman')[0]!
    expect(first.soldier!.rank).toBe(1)
    expect(first.tool).toBe('sword')
    expect(s.state.ledger[1]!.equipped.sword).toBe(1)
    expect([...s.state.settlers.values()].filter(p => p.profession === 'carrier').length).toBe(carriersBefore - 1)
    // No spear exists, so the pikeman order waits instead of conjuring a weapon.
    run(s, 600)
    expect(soldiers(s, 1, 'pikeman')).toEqual([])
    expect(s.state.players[0]!.settings.recruit!.queue.pikeman).toBe(1)
    // Promotion costs manna and applies to soldiers recruited afterwards only. The manna is fixture state here;
    // tests/unit/engine-religion.test.ts earns it from offerings.
    s.state.players[0]!.religion = { manna: 60, produced: 60, promotions: 0, levels: {}, templeLost: false }
    order(s, 'promote', { profession: 'swordsman' })
    order(s, 'recruit', { profession: 'swordsman', count: 1 })
    until(s, () => soldiers(s, 1, 'swordsman').length === 2, 3000)
    expect(soldiers(s, 1, 'swordsman').map(p => p.soldier!.rank).sort()).toEqual([1, 2])
    expect(soldiers(s, 1, 'swordsman').find(p => p.soldier!.rank === 2)!.soldier!.health).toBe(120)
    expect(s.state.players[0]!.religion!.manna).toBe(50)
    // Idle soldiers take their places in the castle garrison.
    const castle = building(s, 'castle')!
    until(s, () => soldiers(s, 1).every(p => p.inside === castle.id), 2000)
    expect(s.view(1).buildings.find(b => b.id === castle.id)!.garrison).toBe(2)
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('automatic recruitment uses every weapon that arrives and survives a restore', () => {
    const s = createSession({ rules, map: landscape(), seed: 4, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { plank: 30, stone: 30, bow: 3 } }] })
    const barracks = place(s, 'barracks', anchors.west)
    until(s, () => s.state.buildings.get(barracks)!.phase === 'active', 6000)
    order(s, 'settings', { settings: { recruitAutomatic: true } })
    run(s, 200)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    until(s, () => soldiers(s, 1, 'bowman').length === 3, 3000)
    copy.advance(s.state.tick - copy.state.tick)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    expect(s.state.ledger[1]!.equipped.bow).toBe(3)
  }, 60_000)

  test('a recruitment interrupted on the way drops the weapon and keeps the order', () => {
    const s = createSession({ rules, map: landscape(), seed: 5, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { plank: 30, stone: 30, sword: 1 } }] })
    const barracks = place(s, 'barracks', anchors.west)
    until(s, () => s.state.buildings.get(barracks)!.phase === 'active', 6000)
    until(s, () => [...s.state.stacks.values()].some(st => st.building === barracks && st.good === 'sword' && st.amount === 1), 2000)
    order(s, 'recruit', { profession: 'swordsman', count: 1 })
    const recruit = (): ReturnType<typeof soldiers>[number] | undefined => [...s.state.settlers.values()].find(p => p.program?.kind === 'enlist')
    until(s, () => recruit()?.cargo === 'sword', 600)
    const carrier = recruit()!
    order(s, 'recruit', { profession: 'swordsman', count: 1 })
    order(s, 'cancel-recruit', { profession: 'swordsman', count: 1 })
    expect(carrier.program?.kind).toBe('enlist')
    expect(carrier.cargo).toBe('sword')
    expect(s.state.players[0]!.settings.recruit!.queue.swordsman).toBeUndefined()
    order(s, 'demolish', { building: barracks })
    run(s, 200)
    expect(carrier.profession).toBe('carrier')
    expect(carrier.cargo).toBeNull()
    expect(soldiers(s, 1)).toEqual([])
    expect(s.state.players[0]!.settings.recruit!.queue.swordsman).toBe(1)
    expect([...s.state.stacks.values()].filter(st => st.good === 'sword').reduce((n, st) => n + st.amount, 0)).toBe(1)
    expect(s.state.ledger[1]!.equipped.sword).toBeUndefined()
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('malformed and impossible orders are refused', () => {
    const s = field([{ profession: 'swordsman', x: 40, y: 70 }], [{ profession: 'swordsman', x: 70, y: 70 }])
    let seq = 1000
    const reject = (type: string, fields: Record<string, unknown>, player = 1): string => {
      s.enqueue({ tick: s.state.tick, player, seq: seq++, type, ...fields })
      s.advance(1)
      return s.state.results.at(-1)!.reason ?? 'accepted'
    }
    expect(reject('recruit', { profession: 'carrier', count: 1 })).toBe('Malformed recruitment order.')
    expect(reject('recruit', { profession: 'swordsman', count: 0 })).toBe('Malformed recruitment order.')
    for (const fields of [{ profession: 'carrier', count: 1 }, { profession: 'swordsman', count: 0 }, { profession: 'swordsman', count: -1 }, { profession: 'swordsman', count: 1.5 }, { profession: 'swordsman', count: 1001 }]) {
      expect(reject('cancel-recruit', fields)).toBe('Malformed recruitment cancellation.')
    }
    expect(reject('cancel-recruit', { profession: 'swordsman', count: 1 })).toBe('There are not that many waiting recruits.')
    order(s, 'recruit', { profession: 'swordsman', count: 1 })
    expect(reject('cancel-recruit', { profession: 'swordsman', count: 2 })).toBe('There are not that many waiting recruits.')
    expect(s.state.players[0]!.settings.recruit!.queue.swordsman).toBe(1)
    expect(reject('settings', { settings: { rank: 2 } })).toBe('Promote soldiers with manna instead.')
    expect(reject('promote', { profession: 'swordsman' })).toBe('A promotion needs 10 manna; you have 0.')
    expect(reject('promote', { profession: 'carrier' })).toBe('Only soldiers can be promoted.')
    const enemy = soldiers(s, 2)[0]!.id, own = soldiers(s, 1)[0]!.id
    expect(reject('move-soldiers', { soldiers: [enemy], x: 1, y: 1 })).toBe('Those are not all your soldiers.')
    expect(reject('move-soldiers', { soldiers: [own], x: 500, y: 1 })).toBe('Choose a tile on the map.')
    expect(reject('attack', { soldiers: [own], building: 999 })).toBe('Choose a visible enemy military building.')
  })
})

describe('combat', () => {
  test('a melee duel is decided by health and strength, the same way every run and after a restore', () => {
    const fight = (): Session => field([{ profession: 'swordsman', x: 40, y: 70 }], [{ profession: 'swordsman', x: 43, y: 70 }])
    const a = fight(), b = fight()
    run(a, 30)
    const mid = restore(JSON.parse(JSON.stringify(save(a))), rules)
    until(a, () => soldiers(a, 1).length === 0 || soldiers(a, 2).length === 0, 2000)
    b.advance(a.state.tick)
    mid.advance(a.state.tick - mid.state.tick)
    expect(checksum(b.state)).toBe(checksum(a.state))
    expect(checksum(mid.state)).toBe(checksum(a.state))
    const survivors = [...soldiers(a, 1), ...soldiers(a, 2)]
    expect(survivors).toHaveLength(1)
    expect(survivors[0]!.soldier!.health).toBeGreaterThan(0)
    expect(survivors[0]!.soldier!.health).toBeLessThan(100)
    const loser = survivors[0]!.owner === 1 ? 2 : 1
    expect(a.state.ledger[loser]!.deaths).toBe(1)
    expect(a.state.events.some(e => e.type === 'death' && e.player === loser)).toBe(true)
  })

  test('arrows fly for a time and hurt only a target still where they were aimed', () => {
    // A castle lets the bowman's player see the pikeman beyond settler sight; a move order keeps the bowman outside.
    const setup = (): Session => field([{ profession: 'bowman', x: 40, y: 54 }], [{ profession: 'pikeman', x: 40, y: 64 }], [{ type: 'castle', x: 40, y: 40 }])
    const s = setup()
    const bowman = soldiers(s, 1)[0]!, pikeman = soldiers(s, 2)[0]!
    order(s, 'move-soldiers', { soldiers: [bowman.id], x: 40, y: 54 })
    until(s, () => (s.state.projectiles ?? []).length > 0, 400)
    const arrow = s.state.projectiles![0]!
    expect(arrow.target).toBe(pikeman.id)
    expect(arrow.arrives - arrow.fired).toBe(4 + 10 * 2)
    expect(pikeman.soldier!.health).toBe(200)
    // Saved mid-flight, the arrow lands the same way after a restore.
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    expect(copy.state.projectiles).toEqual(s.state.projectiles)
    until(s, () => s.state.tick > arrow.arrives, 100)
    expect(pikeman.soldier!.health).toBe(200 - 5)
    copy.advance(s.state.tick - copy.state.tick)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    // A target that has moved away is missed.
    const miss = setup()
    order(miss, 'move-soldiers', { soldiers: [soldiers(miss, 1)[0]!.id], x: 40, y: 54 })
    until(miss, () => (miss.state.projectiles ?? []).length > 0, 400)
    const target = soldiers(miss, 2)[0]!, flying = miss.state.projectiles![0]!
    order(miss, 'move-soldiers', { soldiers: [target.id], x: 48, y: 64 }, 2)
    until(miss, () => miss.state.tick > flying.arrives, 100)
    expect(target.soldier!.health).toBe(200)
  })

  test('bowmen on the walls shoot visible enemies in reach of their building', () => {
    const s = field([{ profession: 'bowman', x: 44, y: 46 }], [{ profession: 'swordsman', x: 40, y: 58 }], [{ type: 'castle', x: 40, y: 40 }])
    const castle = building(s, 'castle')!, door = s.view(1).buildings.find(b => b.id === castle.id)!.door
    const shots = new Set<number>()
    until(s, () => {
      for (const p of s.state.projectiles ?? []) { expect(p.from).toBe(door); shots.add(p.id) }
      return soldiers(s, 2).length === 0
    }, 3000)
    expect(soldiers(s, 1)[0]!.inside).toBe(castle.id)
    // A rank 1 swordsman has 100 health and each arrow takes 5; arrows already in flight land harmlessly.
    expect(shots.size).toBeGreaterThanOrEqual(20)
    run(s, 100)
    expect(s.state.projectiles).toEqual([])
    expect(s.state.ledger[2]!.deaths).toBe(1)
  })
})

describe('wealth', () => {
  const duel = (gold: number, rules_ = rules): Session => createSession({
    rules: rules_, map: landscape(), seed: 1,
    players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: scenario([{ profession: 'swordsman', x: 40, y: 72 }], [{ type: 'castle', x: 40, y: 40 }]) },
      { name: 'Enemy', civilization: 'roman', start: anchors.castle, scenario: scenario([{ profession: 'swordsman', x: 43, y: 72 }]) },
    ],
    ...(gold ? { piles: [{ good: 'gold', x: 44, y: 44, amount: gold }] } : {}),
  })

  test('gold the player can hand out strengthens its soldiers away from home, as the reference computes it', () => {
    const poor = duel(0), rich = duel(490), richer = duel(1000)
    const away = 72 * 96 + 40, home = 44 * 96 + 40
    // log2(22) / 9 for two players without gold; full strength on their own land.
    expect(strength(poor.context, 1, away)).toBe(495)
    expect(strength(poor.context, 1, home)).toBe(1000)
    // 490 gold makes log2(512) / 9 = 1; 1000 gold makes log2(1022) / 9.
    expect(strength(rich.context, 1, away)).toBe(1000)
    expect(richer.state.ledger[1]!.created.gold).toBe(1000)
    expect(strength(richer.context, 1, away)).toBe(Math.floor(Math.log2(1022) / 9 * 1000))
    // Gold reserved for a delivery or waiting as an input does not count.
    const pile = [...rich.state.stacks.values()].find(st => st.good === 'gold')!
    pile.reservedOut = 10
    expect(strength(rich.context, 1, away)).toBeLessThan(1000)
    pile.reservedOut = 0
    // Between equal swordsmen away from home, the one whose player holds gold wins. A hold order keeps ours out of the castle.
    order(rich, 'move-soldiers', { soldiers: [soldiers(rich, 1)[0]!.id], x: 40, y: 72 })
    until(rich, () => soldiers(rich, 1).length === 0 || soldiers(rich, 2).length === 0, 3000)
    expect(soldiers(rich, 1)).toHaveLength(1)
    expect(rich.state.ledger[2]!.deaths).toBe(1)
  })

  test('rules published before wealth existed keep full strength', () => {
    const older = PUBLISHED_RULES.find(r => r.version === '0.3.0')!
    const s = duel(0, older)
    expect(strength(s.context, 1, 72 * 96 + 40)).toBe(1000)
  })
})

describe('movement orders', () => {
  const tile = (s: Session, x: number, y: number): number => y * s.state.map.width + x

  test('waypoints are visited in order, at most three before the destination', () => {
    const s = field([{ profession: 'swordsman', x: 30, y: 70 }], [{ profession: 'swordsman', x: 90, y: 90 }])
    const id = soldiers(s, 1)[0]!.id, visited: number[] = []
    order(s, 'move-soldiers', { soldiers: [id], x: 36, y: 70 })
    order(s, 'move-soldiers', { soldiers: [id], x: 36, y: 76, append: true })
    order(s, 'move-soldiers', { soldiers: [id], x: 30, y: 76, append: true })
    order(s, 'move-soldiers', { soldiers: [id], x: 30, y: 80, append: true })
    s.enqueue({ tick: s.state.tick, player: 1, seq: 900, type: 'move-soldiers', soldiers: [id], x: 20, y: 80, append: true })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('A move has at most three waypoints before its destination.')
    const me = s.state.settlers.get(id)!
    until(s, () => {
      const here = tile(s, me.x, me.y)
      if ([tile(s, 36, 70), tile(s, 36, 76), tile(s, 30, 76), tile(s, 30, 80)].includes(here) && visited.at(-1) !== here) visited.push(here)
      return me.soldier!.order === -2
    }, 2000)
    expect(visited).toEqual([tile(s, 36, 70), tile(s, 36, 76), tile(s, 30, 76), tile(s, 30, 80)])
    expect(me.soldier!.route).toBeUndefined()
  })

  test('a patrol turns around at both ends until another move cancels it, and survives a restore', () => {
    const s = field([{ profession: 'pikeman', x: 30, y: 70 }], [{ profession: 'swordsman', x: 90, y: 90 }])
    const id = soldiers(s, 1)[0]!.id, me = s.state.settlers.get(id)!, start = tile(s, me.x, me.y), end = tile(s, 38, 70)
    order(s, 'move-soldiers', { soldiers: [id], x: 38, y: 70, mode: 'patrol' })
    expect(me.soldier!.patrol).toEqual([start, end])
    let turns = 0, last = start
    until(s, () => { const here = tile(s, me.x, me.y); if ((here === start || here === end) && here !== last) { turns++; last = here } return turns >= 3 }, 3000)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    s.advance(150); copy.advance(150)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    order(s, 'move-soldiers', { soldiers: [id], x: 34, y: 74 })
    expect(me.soldier!.patrol).toBeUndefined()
    until(s, () => me.soldier!.order === -2, 600)
    expect([me.x, me.y]).toEqual([34, 74])
  })

  test('a forced move ignores enemies on the way; a normal move is diverted to fight', () => {
    const setup = (): Session => field([{ profession: 'swordsman', x: 30, y: 70 }], [{ profession: 'swordsman', x: 40, y: 70 }])
    const march = (s: Session, mode?: 'forced'): void => {
      const id = soldiers(s, 1)[0]!.id
      order(s, 'move-soldiers', { soldiers: [id], x: 50, y: 70, ...(mode ? { mode } : {}) })
      until(s, () => s.state.settlers.get(id)?.soldier?.order === -2 || soldiers(s, 1).length === 0 || soldiers(s, 2).length === 0, 2000)
    }
    // Forced: the enemy may strike, but ours never strikes back on the way and arrives.
    const forced = setup()
    march(forced, 'forced')
    const ours = soldiers(forced, 1)[0]!
    expect([ours.x, ours.y]).toEqual([50, 70])
    expect(ours.soldier!.forced).toBeUndefined()
    expect(soldiers(forced, 2)[0]!.soldier!.health).toBe(100)
    // Normal: the enemy in reach diverts the march into a fight to the death.
    const normal = setup()
    march(normal)
    expect((normal.state.ledger[1]?.deaths ?? 0) + (normal.state.ledger[2]?.deaths ?? 0)).toBe(1)
  })

  test('a forced move pulls a soldier out of a fight in progress', () => {
    const s = field([{ profession: 'pikeman', x: 30, y: 70 }], [{ profession: 'swordsman', x: 33, y: 70 }])
    const pikeman = soldiers(s, 1)[0]!
    until(s, () => pikeman.soldier!.health < 300, 400)
    order(s, 'move-soldiers', { soldiers: [pikeman.id], x: 20, y: 60, mode: 'forced' })
    until(s, () => pikeman.soldier!.order === -2 || !s.state.settlers.has(pikeman.id), 1000)
    expect(s.state.settlers.has(pikeman.id)).toBe(true)
    expect([pikeman.x, pikeman.y]).toEqual([20, 60])
  })

  test('orders that make no sense are refused', () => {
    const s = field([{ profession: 'swordsman', x: 30, y: 70 }], [{ profession: 'swordsman', x: 90, y: 90 }])
    const id = soldiers(s, 1)[0]!.id
    s.enqueue({ tick: s.state.tick, player: 1, seq: 901, type: 'move-soldiers', soldiers: [id], x: 31, y: 70, mode: 'sideways' })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('Unknown kind of move.')
    const envelope = save(s)
    envelope.state.settlers.find(p => p.id === id)!.soldier!.route = [1, 2, 3, 4]
    expect(() => restore(envelope, rules)).toThrow('soldier orders are invalid')
  })
})

describe('garrisons and capture', () => {
  function war(): Session {
    return createSession({
      rules, map: landscape([{ kind: 'object', id: 'tree', x: 77, y: 57, radius: 2, density: 0.8 }]), seed: 9,
      players: [
        { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: scenario([{ profession: 'swordsman', x: 44, y: 46 }, { profession: 'swordsman', x: 45, y: 46 }, { profession: 'swordsman', x: 46, y: 46 }], [{ type: 'castle', x: 40, y: 40 }]) },
        { name: 'Enemy', civilization: 'roman', start: { x: 80, y: 40 }, settings: { stored: ['plank'] }, scenario: scenario([{ profession: 'swordsman', x: 84, y: 46 }, { profession: 'carrier', x: 82, y: 47 }, { profession: 'carrier', x: 83, y: 47 }, { profession: 'woodcutter', x: 76, y: 54 }], [{ type: 'castle', x: 80, y: 40 }, { type: 'woodcutter', x: 74, y: 52 }]) },
      ],
      piles: [{ good: 'plank', x: 84, y: 50, amount: 4 }],
    })
  }

  test('a garrison keeps its last soldier; attackers fight the defenders out and take the building with its goods and land', () => {
    const s = war()
    expect(s.skipped).toEqual({})
    const ours = [...s.state.buildings.values()].find(b => b.owner === 1 && b.type === 'castle')!
    const theirs = [...s.state.buildings.values()].find(b => b.owner === 2 && b.type === 'castle')!
    until(s, () => soldiers(s, 1).every(p => p.inside === ours.id) && soldiers(s, 2).every(p => p.inside === theirs.id), 1000)
    // The enemy's woodcutter is at work when the attack comes.
    until(s, () => [...s.state.settlers.values()].some(p => p.profession === 'woodcutter' && p.workplace && p.program?.kind === 'work'), 600)
    // The enemy stores its planks in its castle.
    until(s, () => [...s.state.stacks.values()].some(st => st.building === theirs.id && st.good === 'plank' && st.amount === 4), 3000)
    const [one, two, three] = soldiers(s, 1).map(p => p.id)
    if (one === undefined || two === undefined || three === undefined) throw new Error('The capture fixture requires three garrisoned soldiers.')
    order(s, 'move-soldiers', { soldiers: [one, two], x: 74, y: 44 })
    s.enqueue({ tick: s.state.tick, player: 1, seq: 500, type: 'move-soldiers', soldiers: [three], x: 74, y: 44 })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('Each garrison keeps its last soldier.')
    // Sent soldiers hold the position they reach, close enough to see the enemy castle.
    until(s, () => [one, two].every(id => s.state.settlers.get(id)!.soldier!.order === -2), 2000)
    order(s, 'attack', { soldiers: [one, two], building: theirs.id })
    until(s, () => theirs.owner === 1, 4000)
    expect(s.state.ledger[2]!.deaths).toBe(1)
    expect(soldiers(s, 2)).toEqual([])
    // Goods in the building changed hands with it and stay accounted for on both sides.
    expect(s.state.ledger[2]!.lost).toEqual({ plank: 4 })
    expect(s.state.ledger[1]!.gained).toEqual({ plank: 4 })
    expect([...s.state.stacks.values()].filter(st => st.building === theirs.id).every(st => st.owner === 1)).toBe(true)
    // The land it held is now ours, and the enemy's woodcutter on that land is gone.
    expect(s.state.map.owner[theirs.y * 96 + theirs.x]).toBe(1)
    expect([...s.state.buildings.values()].some(b => b.type === 'woodcutter')).toBe(false)
    // Its woodcutter lost his workplace mid-job and keeps his axe; anything he carried lies on the ground.
    const woodcutter = [...s.state.settlers.values()].find(p => p.profession === 'woodcutter')!
    expect(woodcutter.workplace).toBe(0)
    expect(woodcutter.cargo).toBeNull()
    expect(woodcutter.tool).toBe('axe')
    expect(s.state.events.some(e => e.player === 2 && e.type === 'captured')).toBe(true)
    // A conqueror moves in.
    until(s, () => soldiers(s, 1).some(p => p.inside === theirs.id), 400)
    expect(audit(s.context)).toEqual([])
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    expect(checksum(copy.state)).toBe(checksum(s.state))
  }, 60_000)

  test('a large tower holds three infantry and three bowmen; a lookout tower sees far and claims nothing', () => {
    const soldiersOf = (profession: string, n: number, x: number) => Array.from({ length: n }, (_, i) => ({ profession, x: x + i, y: 70 }))
    const s = createSession({
      rules, map: landscape(), seed: 3,
      players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'large-tower', x: 40, y: 40 }, { type: 'lookout-tower', x: 70, y: 70 }], settlers: [...soldiersOf('swordsman', 4, 40), ...soldiersOf('bowman', 4, 46)] } }],
    })
    const tower = building(s, 'large-tower')!
    until(s, () => [...s.state.settlers.values()].filter(p => p.inside === tower.id).length === 6, 2000)
    const inside = [...s.state.settlers.values()].filter(p => p.inside === tower.id)
    expect(inside.filter(p => p.profession === 'swordsman')).toHaveLength(3)
    expect(inside.filter(p => p.profession === 'bowman')).toHaveLength(3)
    // The lookout tower sees far beyond any soldier or the large tower, but claims no land.
    expect(s.state.players[0]!.visible[70 * 96 + 95]).toBe(1)
    expect(s.state.map.owner[70 * 96 + 70]).toBe(0)
  })

  test('saved soldiers are validated like any other untrusted input', () => {
    const s = war()
    run(s, 40)
    const envelope = save(s)
    const tamper = (change: (state: ReturnType<typeof save>['state']) => void): () => void => () => { const copy = structuredClone(envelope); change(copy.state); restore(copy, rules) }
    expect(tamper(st => { st.settlers.find(p => p.soldier)!.soldier!.rank = 9 })).toThrow('soldier state is invalid')
    expect(tamper(st => { delete st.settlers.find(p => p.soldier)!.soldier })).toThrow('soldier without soldier state')
    expect(tamper(st => { st.settlers.find(p => p.soldier)!.tool = 'bow' })).toThrow()
    expect(tamper(st => { st.players[0]!.settings.rank = 0 })).toThrow('rank is invalid')
  })
})
