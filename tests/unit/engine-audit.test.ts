import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, restore, save, statistics } from '../../resources/game/engine'
import { anchors, building, landscape, order, place, rules, session, until } from '../fixtures/engine'

describe('world accounting audit', () => {
  test('a long seeded economy with storage, demolition, interruption and restores never breaks an invariant', () => {
    const s = session({ seed: 11 })
    order(s, 'settings', { settings: { stored: ['log', 'stone', 'plank', 'coal', 'fish'] } })
    for (const [type, near] of [['woodcutter', anchors.forest], ['woodcutter', anchors.east], ['forester', anchors.south], ['stonecutter', anchors.granite], ['sawmill', anchors.north], ['fisher', anchors.water], ['coal-mine', anchors.mountain]] as const) place(s, type, near)
    let current = s
    for (let tick = 0; tick < 12_000; tick++) {
      current.advance(1)
      if (tick % 5 === 0) expect(audit(current.context)).toEqual([])
      // Interrupt work mid-job: tear down the second woodcutter while its worker may be out.
      if (tick === 4000) { const second = [...current.state.buildings.values()].filter(b => b.type === 'woodcutter')[1]; if (second) order(current, 'demolish', { building: second.id }) }
      if (tick === 6000) order(current, 'suspend', { building: building(current, 'sawmill')!.id, suspended: true })
      if (tick === 7000) order(current, 'suspend', { building: building(current, 'sawmill')!.id, suspended: false })
      // Save and continue from the restored copy at an arbitrary intermediate phase.
      if (tick % 2500 === 1234) { const next = restore(JSON.parse(JSON.stringify(save(current))), rules); expect(checksum(next.state)).toBe(checksum(current.state)); current = next }
    }
    const l = current.state.ledger[1]!
    for (const good of ['log', 'plank', 'stone', 'coal', 'fish']) expect(l.produced[good] ?? 0).toBeGreaterThan(0)
    expect(l.recovered).not.toEqual({})
  }, 120_000)

  test('the audit catches broken reservations, phantom cargo, missing tools and stray goods', () => {
    const s = session()
    place(s, 'woodcutter', anchors.forest)
    until(s, () => [...s.state.jobs.values()].some(j => j.kind === 'deliver' && j.picked), 400)
    expect(audit(s.context)).toEqual([])
    const mutate = (change: (copy: ReturnType<typeof restore>) => void): string[] => { const copy = restore(save(s), rules); change(copy); return audit(copy.context) }
    expect(mutate(c => { [...c.state.stacks.values()].find(st => st.reservedOut > 0)!.reservedOut++ }).join()).toContain('reserves')
    expect(mutate(c => { const job = [...c.state.jobs.values()].find(j => j.picked)!; c.state.settlers.get(job.kind === 'deliver' ? job.carrier : job.settler)!.cargo = null }).join()).toContain('does not carry it')
    expect(mutate(c => { [...c.state.settlers.values()].find(p => p.profession === 'builder')!.tool = null }).join()).toContain('without a hammer')
    expect(mutate(c => { [...c.state.stacks.values()].find(st => st.role === 'ground')!.amount++ }).join()).toContain('ledger expects')
    expect(mutate(c => { c.state.jobs.delete([...c.state.jobs.keys()][0]!) }).length).toBeGreaterThan(0)
  })

  test('construction sites are served before storage when both want the same goods', () => {
    const s = session({ settlers: { carrier: 6, digger: 2, builder: 2 } })
    const site = place(s, 'sawmill', anchors.west)
    order(s, 'settings', { settings: { stored: ['plank', 'stone'] } })
    const b = s.state.buildings.get(site)!
    // Watch the first deliveries: every early plank and stone trip goes to the site.
    const firstTargets: number[] = []
    until(s, () => {
      for (const j of s.state.jobs.values()) if (j.kind === 'deliver' && !firstTargets.includes(j.id) && (j.good === 'plank' || j.good === 'stone')) firstTargets.push(j.id, s.state.stacks.get(j.target)!.building)
      return b.phase === 'active'
    }, 6000)
    const buildingsServed = firstTargets.filter((_, i) => i % 2 === 1)
    const firstStorage = buildingsServed.findIndex(id => id !== site)
    const siteTrips = buildingsServed.filter(id => id === site).length
    expect(siteTrips).toBe(7)
    // Storage trips for planks and stone only begin once the site has every delivery it asked for.
    expect(firstStorage).toBeGreaterThan(0)
    expect(buildingsServed.slice(firstStorage).every(id => id !== site)).toBe(true)
  }, 30_000)
})

describe('statistics', () => {
  test('totals by location and in transit equal the world, exclude other players and follow mission goals', () => {
    const s = createSession({
      rules, map: landscape(), seed: 2, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }],
      mission: { id: 'stock', version: 1, objectives: [{ id: 'planks', player: 1, text: 'Stock 60 planks' }], triggers: [{ id: 'planks', when: { kind: 'goods-at-least', player: 1, good: 'plank', amount: 60 }, then: [{ kind: 'complete-objective', objective: 'planks' }] }] },
    })
    place(s, 'sawmill', anchors.west)
    until(s, () => [...s.state.settlers.values()].some(p => p.cargo), 400)
    const stats = statistics(s, 1)
    const summed: Record<string, number> = {}
    for (const place of Object.values(stats.stock)) for (const [g, n] of Object.entries(place)) summed[g] = (summed[g] ?? 0) + n
    expect(summed).toEqual(stats.total)
    expect(stats.total).toEqual(s.view(1).goods)
    expect(Object.values(stats.stock.transit).reduce((a, n) => a + n, 0)).toBe([...s.state.settlers.values()].filter(p => p.cargo).length)
    expect(stats.occupations.carrier!.total).toBe([...s.state.settlers.values()].filter(p => p.profession === 'carrier').length)
    expect(stats.goals).toEqual([{ objective: 'planks', good: 'plank', have: stats.total.plank ?? 0, need: 60 }])
    expect(statistics(s, 1).produced).toEqual(s.state.ledger[1]!.produced)
  })
})
