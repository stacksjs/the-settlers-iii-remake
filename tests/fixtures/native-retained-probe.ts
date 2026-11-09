import { audit, createReplayVerifier, record, ROMAN_ENGINEERING, restore, save } from '../../resources/game/engine/runtime'
import type { ReplayVerifier } from '../../resources/game/engine/runtime'
import { nativeStaffingScenario } from './native-staffing-scenario'

// Evaluated once. Every later invocation enters the same retained closure,
// advancing one simulation or verification tick through the public engine API.
const rules = ROMAN_ENGINEERING
let recorder: ReturnType<typeof record> | undefined
let verifier: ReplayVerifier | undefined
let created = ''
let proof: { tick: number, checksum: string, restoredChecksum: string, storagePhase: string, createdUnchanged: boolean } | undefined
function frame(): number | string {
  if (!recorder) {
    const session = nativeStaffingScenario()
    recorder = record(session)
    created = JSON.stringify(session.state.ledger[1]!.created)
    if (recorder.enqueue({ tick: 0, player: 1, seq: 0, type: 'build', building: 'storage', x: 40, y: 22 })) throw new Error('Shared staffing build rejected')
    return 0
  }
  const session = recorder.session
  if (session.state.tick < 5000) { recorder.advance(1); return session.state.tick }
  if (!verifier) {
    const restored = restore(JSON.parse(JSON.stringify(save(session))), rules)
    try {
      const checksum = session.checksum(), restoredChecksum = restored.checksum()
      const storagePhase = session.view(1).buildings.find(b => b.type === 'storage')?.phase
      if (checksum !== restoredChecksum || storagePhase !== 'active' || JSON.stringify(session.state.ledger[1]!.created) !== created || audit(session.context).length)
        throw new Error('Shared reachable staffing checkpoint or accounting differs')
      proof = { tick: session.state.tick, checksum, restoredChecksum, storagePhase, createdUnchanged: true }
    }
    finally { restored.dispose() }
    verifier = createReplayVerifier(recorder.replay(), rules)
    return 5000
  }
  const progress = verifier.advance(1)
  if (!progress.result) return 5000 + progress.ticks
  if (!progress.result.ok) throw new Error('Shared reachable staffing replay differs')
  const result = JSON.stringify({ tick: proof!.tick, checksum: proof!.checksum, restoredChecksum: proof!.restoredChecksum, replay: progress.result, storagePhase: proof!.storagePhase, createdUnchanged: true })
  verifier.dispose()
  session.dispose()
  return result
}
// Keep the callable completion value in the bundle's emitted program.
frame.bind(null)
