# Worker release after demolition

Recorded 2026-10-23 UTC for [issue 35](https://github.com/stacksjs/the-settlers-iii-remake/issues/35). This is a verified engine repair; the issue remains open.

A regression through the public game-session API places a woodcutter, waits for its worker to claim a real resource tile, and demolishes the building. Before the fix, the released worker still owned that resource claim. The failing run retained worker `15` in the claim map after demolition.

Worker release now detaches the worker and invokes its interrupted program's existing cleanup handler. That handler releases resource claims and output reservations. Detaching first prevents it from sending the worker back to the removed workplace. The demolition-specific claim sweep, which inspected workplace IDs after they had already been cleared, is removed.

`./buddy test --unit` passed 201 tests with zero failures and 20,786 assertions. The focused economy, military, AI recovery and accounting checks passed 61 tests and 3,607 assertions. `./buddy lint` reported zero errors and warnings; `./buddy typecheck` passed. These checks used the application's declared Bun 1.4.2 toolchain and existing framework 0.75.277.

The regression verifies simulation bookkeeping and conservation. It does not measure original-game behavior, refund rules, visuals or native game execution. Original Gold Edition observations and the broader issue acceptance remain unverified.

Retained local execution log SHA-256 values:

- `game-demolition-worker-claim-red.log`: `7e52375f049770d8e6062b5378ba43f42e27f0ebd7ecb5d067a0d7b50e1e324a`.
- `game-demolition-worker-claim-green.log`: `7fce08330a8fbe4b30b21ca783017078d43f450aeb43a12e6a342a71a0ac0f1b`.
- `game-demolition-worker-claim-all-checks.log`: `ce7f5739b1c8b541b24409fd82e63ec8c9e65f8fbcf6b25343e5dae58a6311fa`.
