import { createSession, describeMap, ROMAN_ENGINEERING, record, verify, save, restore } from '../../resources/game/engine'
const rules = ROMAN_ENGINEERING
const session = createSession({ rules, map: describeMap(rules, { width: 32, height: 32, base: 'grass', seed: 5, features: [] }), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 } }] })
const recorder = record(session)
const rejected = recorder.enqueue({ tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })
if (rejected) throw new Error(rejected.reason)
recorder.advance(5)
const serialized = save(session)
const restored = restore(JSON.parse(JSON.stringify(serialized)), rules)
const proof = { tick: session.state.tick, checksum: session.checksum(), restoredChecksum: restored.checksum(), replay: verify(recorder.replay(), rules) }
restored.dispose()
session.dispose()
JSON.stringify(proof)
