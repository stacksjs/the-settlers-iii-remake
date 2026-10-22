import type { MissionDefinition } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { checksum, createSession, missionFromVictory, MissionError, restore, save, validateMission } from '../../resources/game/engine'
import { anchors, landscape, order, place, rules, run } from '../fixtures/engine'

const world = { players: 1, width: 96, height: 96, goods: rules.goods, buildings: rules.buildings.map(b => b.id) }

// Three stages: build timber production, then stock planks, then a timed reveal and victory.
const campaign: MissionDefinition = {
  id: 'timber-trial', version: 1,
  objectives: [
    { id: 'woodcutter', player: 1, text: 'Build a woodcutter\'s hut' },
    { id: 'planks', player: 1, text: 'Stock 20 planks' },
  ],
  triggers: [
    { id: 'welcome', when: { kind: 'tick-at-least', tick: 0 }, then: [{ kind: 'message', player: 1, text: 'Build a woodcutter.' }] },
    { id: 'built', when: { kind: 'buildings-at-least', player: 1, building: 'woodcutter', count: 1 }, then: [{ kind: 'complete-objective', objective: 'woodcutter' }, { kind: 'reveal', player: 1, x: 80, y: 80, radius: 3 }] },
    { id: 'stocked', when: { kind: 'all', of: [{ kind: 'trigger-fired', trigger: 'built' }, { kind: 'goods-at-least', player: 1, good: 'plank', amount: 20 }] }, then: [{ kind: 'complete-objective', objective: 'planks' }] },
    { id: 'won', when: { kind: 'all', of: [{ kind: 'objective-complete', objective: 'woodcutter' }, { kind: 'objective-complete', objective: 'planks' }] }, then: [{ kind: 'victory', player: 1 }] },
  ],
}

describe('mission runtime', () => {
  test('runs a multi-stage mission, survives a mid-mission save and reports progress in the player view', () => {
    const s = createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }], mission: campaign })
    run(s, 40)
    expect(s.view(1).events.some(e => e.type === 'mission' && e.text === 'Build a woodcutter.')).toBe(true)
    expect(s.view(1).mission).toEqual({ objectives: [{ id: 'woodcutter', text: 'Build a woodcutter\'s hut', status: 'open' }, { id: 'planks', text: 'Stock 20 planks', status: 'open' }], outcome: 'playing' })
    place(s, 'woodcutter', anchors.forest)
    // Save while the first stage is in progress and continue both copies.
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    run(s, 3000); copy.advance(3000)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    expect(s.state.mission!.objectives).toEqual({ woodcutter: 'complete', planks: 'complete' })
    expect(s.state.mission!.fired).toEqual(['welcome', 'built', 'stocked', 'won'])
    expect(s.view(1).mission!.outcome).toBe('won')
    expect(s.state.players[0]!.explored[80 * 96 + 80]).toBe(1)
    // Fired triggers do not repeat.
    const events = s.state.events.filter(e => e.type === 'mission').length
    run(s, 200)
    expect(s.state.events.filter(e => e.type === 'mission').length).toBe(events)
  }, 60_000)

  test('rejects scripts, unknown vocabulary, dangling references, cycles and oversized data', () => {
    const problems = (value: unknown): string => { try { validateMission(value, world); return 'valid' } catch (error) { return error instanceof MissionError ? error.problems.join(' | ') : String(error) } }
    expect(problems(campaign)).toBe('valid')
    expect(problems({ ...campaign, script: 'process.exit()' })).toContain('unknown field script')
    expect(problems({ ...campaign, triggers: [{ id: 'x', when: { kind: 'eval', code: '1' }, then: [] }] })).toContain('unknown condition eval')
    expect(problems({ ...campaign, triggers: [{ id: 'x', when: { kind: 'tick-at-least', tick: 1 }, then: [{ kind: 'run', source: 'alert(1)' }] }] })).toContain('unknown action run')
    expect(problems({ ...campaign, triggers: [{ id: 'x', when: { kind: 'tick-at-least', tick: 1, extra: true }, then: [] }] })).toContain('invalid tick-at-least condition')
    expect(problems({ ...campaign, triggers: [{ id: 'x', when: { kind: 'trigger-fired', trigger: 'missing' }, then: [] }] })).toContain('invalid trigger-fired condition')
    expect(problems({ ...campaign, triggers: [{ id: 'x', when: { kind: 'goods-at-least', player: 2, good: 'plank', amount: 1 }, then: [] }] })).toContain('invalid goods-at-least')
    expect(problems({ ...campaign, triggers: [
      { id: 'a', when: { kind: 'trigger-fired', trigger: 'b' }, then: [] },
      { id: 'b', when: { kind: 'all', of: [{ kind: 'trigger-fired', trigger: 'c' }] }, then: [] },
      { id: 'c', when: { kind: 'trigger-fired', trigger: 'a' }, then: [] },
    ] })).toContain('triggers wait on each other: a -> b -> c -> a')
    let deep: unknown = { kind: 'tick-at-least', tick: 1 }
    for (let i = 0; i < 12; i++) deep = { kind: 'not', of: deep }
    expect(problems({ ...campaign, triggers: [{ id: 'deep', when: deep, then: [] }] })).toContain('nests conditions too deeply')
    expect(problems({ ...campaign, triggers: Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, when: { kind: 'tick-at-least', tick: i }, then: [] })) })).toContain('too many')
    expect(problems({ ...campaign, objectives: [...campaign.objectives, campaign.objectives[0]] })).toContain('defined twice')
    expect(() => createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }], mission: { ...campaign, triggers: [{ id: 'x', when: { kind: 'eval' }, then: [] }] } as unknown as MissionDefinition })).toThrow(MissionError)
  })

  test('saves with tampered mission progress are refused', () => {
    const s = createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }], mission: campaign })
    run(s, 20)
    const envelope = save(s)
    const tamper = (change: (e: typeof envelope) => void): string => { const copy = structuredClone(envelope); change(copy); try { restore(copy, rules); return 'restored' } catch (error) { return (error as { code?: string }).code ?? 'other' } }
    expect(tamper(e => { e.state.mission!.fired.push('nonexistent') })).toBe('damaged')
    expect(tamper(e => { e.state.mission!.objectives.woodcutter = 'won' as never })).toBe('damaged')
    expect(tamper(e => { (e.state.mission!.definition.triggers[0]!.when as { kind: string }).kind = 'eval' })).toBe('damaged')
  })

  test('original victory records become objectives only where their meaning is supported', () => {
    const numbering = new Map([[0, 1], [1, 2]])
    const { definition, unsupported } = missionFromVictory({
      killPlayers: { enabled: true, players: [false, true, true] },
      destroyBuildings: { enabled: true, targets: [] },
      conquerPositions: { enabled: true, positions: [{ enabled: true, x: 10, y: 12 }, { enabled: false, x: 0, y: 0 }] },
      survive: { enabled: true, durations: [5] },
      produceGoods: { enabled: true, goals: [{ amount: 30, good: 1 }, { amount: 5, good: 99 }] },
    }, 1, numbering, code => (code === 1 ? 'plank' : null))
    expect(definition.objectives.map(o => o.id)).toEqual(['defeat-2', 'conquer-0', 'produce-0'])
    expect(unsupported).toEqual(['defeat original player 2, who is not in this session', 'produce goods goal 1 uses good 99', 'destroy-buildings goals need decoded building identities (S3-006)', 'survive goals have unverified duration units (S3-006)'])
    expect(() => validateMission(definition, { ...world, players: 2 })).not.toThrow()
  })

  test('a player without military buildings is defeated', () => {
    const s = createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }], mission: { id: 'hold', version: 1, objectives: [], triggers: [{ id: 'fallen', when: { kind: 'player-defeated', player: 1 }, then: [{ kind: 'defeat', player: 1 }] }] } })
    run(s, 40)
    expect(s.view(1).mission!.outcome).toBe('playing')
    order(s, 'demolish', { building: [...s.state.buildings.values()].find(b => b.type === 'castle')!.id })
    run(s, 40)
    expect(s.view(1).mission!.outcome).toBe('lost')
    expect(s.view(1).events.some(e => e.type === 'outcome')).toBe(true)
  })
})
