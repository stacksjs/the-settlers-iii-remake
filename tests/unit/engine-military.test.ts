import type { PlayerSetup, Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, restore, save } from '../../resources/game/engine'
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
    // Promotion applies to soldiers recruited afterwards only.
    order(s, 'settings', { settings: { rank: 3 } })
    order(s, 'recruit', { profession: 'swordsman', count: 1 })
    until(s, () => soldiers(s, 1, 'swordsman').length === 2, 3000)
    expect(soldiers(s, 1, 'swordsman').map(p => p.soldier!.rank).sort()).toEqual([1, 3])
    expect(soldiers(s, 1, 'swordsman').find(p => p.soldier!.rank === 3)!.soldier!.health).toBe(150)
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
    expect(reject('settings', { settings: { rank: 4 } })).toBe('Rank must be 1 to 3.')
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

describe('garrisons and capture', () => {
  function war(): Session {
    return createSession({
      rules, map: landscape(), seed: 9,
      players: [
        { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: scenario([{ profession: 'swordsman', x: 44, y: 46 }, { profession: 'swordsman', x: 45, y: 46 }, { profession: 'swordsman', x: 46, y: 46 }], [{ type: 'castle', x: 40, y: 40 }]) },
        { name: 'Enemy', civilization: 'roman', start: { x: 80, y: 40 }, settings: { stored: ['plank'] }, scenario: scenario([{ profession: 'swordsman', x: 84, y: 46 }, { profession: 'carrier', x: 82, y: 47 }, { profession: 'carrier', x: 83, y: 47 }], [{ type: 'castle', x: 80, y: 40 }, { type: 'woodcutter', x: 70, y: 52 }]) },
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
    // The enemy stores its planks in its castle.
    until(s, () => [...s.state.stacks.values()].some(st => st.building === theirs.id && st.good === 'plank' && st.amount === 4), 3000)
    const [one, two, three] = soldiers(s, 1).map(p => p.id)
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
    expect(s.state.events.some(e => e.player === 2 && e.type === 'captured')).toBe(true)
    // A conqueror moves in.
    until(s, () => soldiers(s, 1).some(p => p.inside === theirs.id), 400)
    expect(audit(s.context)).toEqual([])
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    expect(checksum(copy.state)).toBe(checksum(s.state))
  }, 60_000)

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
