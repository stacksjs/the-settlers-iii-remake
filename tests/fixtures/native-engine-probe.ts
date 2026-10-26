import { audit, createSession, describeMap, ROMAN_ENGINEERING, record, verify, save, restore } from '../../resources/game/engine'
const rules = ROMAN_ENGINEERING
function checkpoint(recorder: ReturnType<typeof record>) {
  const session = recorder.session, restored = restore(JSON.parse(JSON.stringify(save(session))), rules)
  const proof = { tick: session.state.tick, checksum: session.checksum(), restoredChecksum: restored.checksum(), replay: verify(recorder.replay(), rules) }
  restored.dispose()
  if (proof.checksum !== proof.restoredChecksum || !proof.replay.ok || audit(session.context).length) throw new Error('Shared fixture checkpoint or accounting differs')
  return proof
}
const session = createSession({ rules, map: describeMap(rules, { width: 32, height: 32, base: 'grass', seed: 5, features: [] }), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 } }] })
const recorder = record(session)
const rejected = recorder.enqueue({ tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })
if (rejected) throw new Error(rejected.reason)
recorder.advance(5)
const baseline = checkpoint(recorder)
session.dispose()

const crew = createSession({ rules, map: describeMap(rules, { width: 32, height: 32, base: 'grass', seed: 5, features: [] }), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 } }] })
const crewRecord = record(crew), created = JSON.stringify(crew.state.ledger[1]!.created)
if (crewRecord.enqueue({ tick: 0, player: 1, seq: 0, type: 'settings', settings: { builderLimit: 2, diggerLimit: 2 } })) throw new Error('Shared crew control rejected')
crewRecord.advance(5)
const builderCount = crew.view(1).professions.builder, diggerCount = crew.view(1).professions.digger
const hammers = crew.view(1).goods.hammer, shovels = crew.view(1).goods.shovel
if (builderCount !== 2 || diggerCount !== 2 || hammers !== 6 || shovels !== 4 || JSON.stringify(crew.state.ledger[1]!.created) !== created) throw new Error('Shared crew tools were not recovered physically')
const crewRecovery = { ...checkpoint(crewRecord), builderCount, diggerCount, hammers, shovels, createdUnchanged: true }
crew.dispose()

const ownership = createSession({ rules, seed: 5, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [] }), players: [
  { name: 'One', civilization: 'roman', start: { x: 1, y: 1 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 10, y: 20 }] } },
  { name: 'Two', civilization: 'roman', start: { x: 16, y: 16 }, settlers: {}, goods: {} },
], piles: [{ x: 10, y: 20, good: 'hammer', amount: 3 }] })
if (audit(ownership.context).length) throw new Error('Shared ownership setup is invalid')
const ownershipRecord = record(ownership)
if (ownershipRecord.enqueue({ tick: 0, player: 1, seq: 0, type: 'dismiss', profession: 'geologist', count: 1 })) throw new Error('Shared tool return rejected')
ownershipRecord.advance(5)
const ownHammers = ownership.view(1).goods.hammer, foreignHammers = ownership.view(2).goods.hammer
if (ownHammers !== 1 || foreignHammers !== 3) throw new Error('Shared tool changed ownership')
const pileOwnership = { ...checkpoint(ownershipRecord), ownHammers, foreignHammers }
ownership.dispose()
const proof = { ...baseline, crewRecovery, pileOwnership }
JSON.stringify(proof)
