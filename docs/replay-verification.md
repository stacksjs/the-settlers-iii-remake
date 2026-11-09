# Incremental replay verification

`createReplayVerifier(replay, rules)` restores one owned simulation and checks
a recording across calls. Browser, server and retained native hosts choose when
to call it. The existing `verify(replay, rules)` runs the same verifier to
completion synchronously.

```ts
import { createReplayVerifier } from '../resources/game/engine/runtime'

const verifier = createReplayVerifier(replay, rules)
try {
  let progress = verifier.advance(0)
  while (!progress.result) {
    await nextHostTurn()
    progress = verifier.advance(10)
  }
  return progress.result
}
finally {
  verifier.dispose()
}
```

`nextHostTurn` above is the caller's scheduler. The verifier creates no timers
or event loop. Each `advance(count)` checks at most `count` simulation ticks,
with a default of one. Counts must be integers from zero to one million. This
is a tick budget, not a wall-clock or instruction budget: restoring a large
save, processing many same-tick commands or advancing a dense world can still
be expensive.

Progress contains the absolute simulation `tick`, the number of successfully
verified transitions in `ticks`, the recording's `total` transitions, a terminal
`result` or `null`, and `disposed`. `progress()` reads a detached snapshot.
A divergent transition advances the restored simulation but does not count as
successfully verified. Its result retains the existing diagnostic convention:
the transition's starting tick, or the end tick for a final snapshot mismatch.

Recordings and rules are copied at creation. Later caller edits cannot change
verification. The full timeline and checksum syntax are validated before any
ticks advance. Legacy format 1 recordings retain their existing arrival-time
interpretation. Final pending commands are verified even for zero-tick
recordings, where `advance(0)` can complete the result.

Completion, execution errors and explicit disposal release the owned session.
Completed results remain readable; another advance returns the terminal result.
Disposal is idempotent and prevents later advances. A caller cancelling work
should dispose in its own cleanup path.

## Entrypoints

`resources/game/engine/runtime.ts` exports simulation APIs without loading the
historical and faction catalogs. Hosts supplying a selected rules profile can
use it directly. `resources/game/engine/index.ts` retains the complete interface,
including `PUBLISHED_RULES` and faction profile selection for saved games.
This split does not change rules, saved profiles or engine behavior.

## Checks and limits

- `bun test tests/unit/engine-replay.test.ts` checks batching, divergence,
  pending commands, legacy recordings, input ownership and cancellation.
- `bun tests/browser/replay.ts` runs the full retained construction/save/replay
  fixture through the installed Stacks browser driver. It uses an isolated
  loopback server and requires the known complete result without browser errors.
- `CRAFT_SOURCE=/path/to/craft CRAFT_ZIG=/path/to/pinned/zig bun scripts/native-retained-check.ts`
  builds a headless consumer of Craft's public `PersistentRuntime` from a clean
  source snapshot. It evaluates the bundle once, retains the returned callback,
  and compares the complete native result with Bun and the original synchronous
  fixture. The receipt retains source, toolchain, host and bundle identities and
  fails if native loading or execution fails. It changes no interpreter guards
  or runtime options.

The retained scenario is the existing Roman construction scenario, with 5,000
ticks and no shortened window. Browser success does not establish native
loading, presentation, HUD delivery, archived-profile loading or Gold fidelity.
The native source runs currently fail during bundle loading with `OutOfMemory`
under Craft's default heap limit, before the first callback. See issue #244 and
the retained execution evidence. S3-023 and S3-092 remain open.
