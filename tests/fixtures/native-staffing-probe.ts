import { audit, ROMAN_ENGINEERING, record, verify, save, restore } from '../../resources/game/engine'
import { nativeStaffingScenario } from './native-staffing-scenario'
const rules = ROMAN_ENGINEERING
function checkpoint(recorder: ReturnType<typeof record>) {
  const session = recorder.session, restored = restore(JSON.parse(JSON.stringify(save(session))), rules)
  const proof = { tick: session.state.tick, checksum: session.checksum(), restoredChecksum: restored.checksum(), replay: verify(recorder.replay(), rules) }
  restored.dispose()
  if (proof.checksum !== proof.restoredChecksum || !proof.replay.ok || audit(session.context).length) throw new Error('Shared fixture checkpoint or accounting differs')
  return proof
}
const staffing = nativeStaffingScenario()
const staffingRecord = record(staffing), staffingCreated = JSON.stringify(staffing.state.ledger[1]!.created)
if (staffingRecord.enqueue({ tick: 0, player: 1, seq: 0, type: 'build', building: 'storage', x: 40, y: 22 })) throw new Error('Shared staffing build rejected')
staffingRecord.advance(5000)
const storagePhase = staffing.view(1).buildings.find(b => b.type === 'storage')?.phase
if (storagePhase !== 'active' || JSON.stringify(staffing.state.ledger[1]!.created) !== staffingCreated) throw new Error('Shared reachable staffing did not finish physically')
const reachableStaffing = { ...checkpoint(staffingRecord), storagePhase, createdUnchanged: true }
staffing.dispose()
JSON.stringify(reachableStaffing)
