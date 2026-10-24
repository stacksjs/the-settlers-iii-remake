import { expect, test } from 'bun:test'
import { anchors, conserved, landscape, order, place, run, session, until } from '../fixtures/engine'

test('tool assignments count toward the builder limit before equipping finishes', () => {
  const s = session({ settlers: { carrier: 12 }, goods: { plank: 30, stone: 30, hammer: 6, shovel: 6 } })
  order(s, 'settings', { settings: { builderLimit: 1, diggerLimit: 1, carrierRatio: 0 } })
  place(s, 'sawmill', anchors.west)
  place(s, 'storage', anchors.east)
  place(s, 'small-residence', anchors.north)
  let pending = false
  for (let tick = 0; tick < 250; tick++) {
    run(s, 1)
    const employed = [...s.state.settlers.values()].filter(person => person.owner === 1 && person.profession === 'builder').length
    const assigned = [...s.state.jobs.values()].filter(job => job.owner === 1 && job.kind === 'equip' && job.profession === 'builder').length
    pending ||= assigned > 0
    expect(employed + assigned).toBeLessThanOrEqual(1)
    expect(conserved(s)).toBe(true)
  }
  expect(pending).toBe(true)
})

test('pending tool assignments preserve the carrier reserve across sites', () => {
  const s = session({ settlers: { carrier: 12 }, goods: { plank: 30, stone: 30, hammer: 6, shovel: 6 } })
  order(s, 'settings', { settings: { builderLimit: 6, carrierRatio: 90 } })
  place(s, 'sawmill', anchors.west)
  place(s, 'storage', anchors.east)
  place(s, 'small-residence', anchors.north)
  let pending = false
  for (let tick = 0; tick < 250; tick++) {
    run(s, 1)
    const people = [...s.state.settlers.values()].filter(person => person.owner === 1)
    const leaving = [...s.state.jobs.values()].filter(job => job.owner === 1 && job.kind === 'equip').length
    pending ||= leaving > 0
    const carriers = people.filter(person => person.profession === 'carrier').length
    expect(carriers - leaving).toBeGreaterThanOrEqual(Math.ceil(people.length * 0.9))
  }
  expect(pending).toBe(true)
})

test('barracks count pending recruits against the same carrier reserve', () => {
  const s = session({ goods: { plank: 30, stone: 30, sword: 3, bow: 3 } })
  const barracks = place(s, 'barracks', anchors.west)
  until(s, () => s.state.buildings.get(barracks)!.phase === 'active', 6000)
  until(s, () => ['sword', 'bow'].every(good => [...s.state.stacks.values()].some(stack => stack.building === barracks && stack.good === good && stack.amount > 0)), 2000)
  const before = [...s.state.settlers.values()]
  const reserve = before.filter(person => person.profession === 'carrier').length - 1
  order(s, 'settings', { settings: { carrierRatio: Math.floor(reserve * 100 / before.length), recruitAutomatic: true } })
  let pending = false
  for (let tick = 0; tick < 250; tick++) {
    run(s, 1)
    const people = [...s.state.settlers.values()]
    const leaving = [...s.state.jobs.values()].filter(job => job.owner === 1 && job.kind === 'equip').length
    pending ||= leaving > 0
    expect(people.filter(person => person.profession === 'carrier').length - leaving).toBeGreaterThanOrEqual(reserve)
  }
  expect(pending).toBe(true)
})

test('digger limits include workers collecting shovels for separate sites', () => {
  const map = landscape([anchors.west, anchors.east, anchors.north].map(point => ({ kind: 'elevation' as const, ...point, radius: 3, amount: 6 })))
  const s = session({ map, settlers: { carrier: 12 }, goods: { plank: 30, stone: 30, shovel: 6 } })
  order(s, 'settings', { settings: { builderLimit: 0, diggerLimit: 1, carrierRatio: 0 } })
  place(s, 'sawmill', anchors.west)
  place(s, 'storage', anchors.east)
  place(s, 'small-residence', anchors.north)
  let recruited = false
  for (let tick = 0; tick < 250; tick++) {
    run(s, 1)
    const employed = [...s.state.settlers.values()].filter(person => person.profession === 'digger').length
    const assigned = [...s.state.jobs.values()].filter(job => job.kind === 'equip' && job.profession === 'digger').length
    recruited ||= employed + assigned > 0
    expect(employed + assigned).toBeLessThanOrEqual(1)
  }
  expect(recruited).toBe(true)
})

test('one construction crew includes its workers collecting tools', () => {
  const s = session({ settlers: { carrier: 12 }, goods: { plank: 30, stone: 30, hammer: 6 } })
  order(s, 'settings', { settings: { builderLimit: 6, carrierRatio: 0 } })
  const id = place(s, 'storage', anchors.west)
  let pending = false
  for (let tick = 0; tick < 250; tick++) {
    run(s, 1)
    pending ||= [...s.state.jobs.values()].some(job => job.kind === 'equip' && job.building === id)
    expect(s.state.buildings.get(id)!.workers.length).toBeLessThanOrEqual(2)
  }
  expect(pending).toBe(true)
})
