# Source ownership and upstream delivery

The user authorized source improvements, package patch releases, downstream Stacks upgrades, GitHub issue publication, and normal pushes to each owning `origin/main` as Chris without coauthor trailers. Preserve unrelated work in every checkout. Use isolated worktrees and integrate current upstream before publishing.

## Ownership

| Source | Owning repository | Local checkout |
|---|---|---|
| Game rules, assets, campaigns, application controls | stacksjs/the-settlers-iii-remake | ~/Code/the-settlers-iii-remake |
| Compiler, signals, native stx control/surface contract | stacksjs/stx | ~/Code/Tools/stx |
| Native graphics, host runtime, storage, audio, input, lifecycle | craft-native/craft | ~/Code/Tools/craft |
| Build, configuration, signing, release and store orchestration | stacksjs/stacks | ~/Code/stacks |
| Shared utility/style semantics | stacksjs/ts-css | ~/Code/Libraries/ts-css |
| Executed HomeOS shared-graphics consumer | home-lang/home-os | ~/Code/Home/os |

Discover other owners from the actual dependency and remote under ~/Code. Do not patch a consumer to disguise an upstream defect. Read each owning AGENTS.md and relevant skill before changing its source.

## Required sequence

1. Reproduce the failure through the owning public interface and retain that regression there.
2. Implement and run focused tests, lint, type checks, builds, export verification, and installed-consumer checks.
3. Integrate current origin/main, review the exact diff, and rerun affected checks.
4. Run the repository's existing `bun run release:patch`. Preserve its preflight, commit, tag, push, and CI semantics. Do not create replacement release machinery.
5. Verify the actual released package/native artifacts and successful release gates. A tag or a successful bump command alone is insufficient.
6. Install verified versions into Stacks, update manifests/locks, test and patch-release Stacks when affected.
7. Install the verified packages into the game, run frozen install and application acceptance, then push tested commits.
8. Record source SHAs, versions, checks, lockfile identity, signed checksums, and store processing state in a release receipt and the relevant issues.

Use conventional commits authored and committed as `Chris <chris@stacksjs.com>` without agent attribution. Push normally, never force-push. Do not reset, stash, stage, or include another task's working files.

HomeOS is not a Bun package repository. Use its canonical build and source provenance for shared-source integration rather than adding a pretend npm patch release.

## Production credentials

Use existing Buddy environment encryption to commit encrypted production values in `.env.production`. Keep `.env.keys`, all decryption keys, plaintext signing keys/certificates, keystores, and temporary signing files untracked and out of artifacts. Supply the production decryption key through the protected CI environment. Materialize required signing files with restrictive permissions during signing and remove them afterward. Do not pass plaintext secrets in shell arguments or display them in logs.

Inspect existing Apple team resources before creating replacements. Reuse valid identifiers, certificates, profiles, and API permissions. Account login and local identities are not proof that every required distribution resource exists. Keep unavoidable account agreements, owner attestations, and bootstrap steps explicit; do not fabricate their completion. Extend existing Stacks Apple/Android release modules and reusable workflows.

## Issue lifecycle

The registry records 120 slots, including adopted source issues. Reconcile stable remote markers before creating anything, preserve adopted issue bodies/titles/parents, and retain actual URLs. Use native parent and blocking relationships where GitHub permits them; every body also contains explicit dependencies. Record platform-imposed relationship restrictions instead of losing edges.

Only open issues whose blockers were closed as completed receive `ready-for-agent`. Closing a required blocker as not planned does not satisfy it. A documented partial correction can advance an issue without closing it. Close only after every acceptance criterion has evidence. Never close an epic because its tracking entries were created.

## Shared engine native CLI check

Run `bun scripts/native-engine-check.ts` with the qualified native Craft executable available through the SDK's normal resolver. It bundles `tests/fixtures/native-engine-probe.ts` once and runs the same artifact in Bun and Craft's own JavaScript engine. The fixture queues a future command, advances five ticks, restores its save and verifies its replay. Missing executables, runtime errors, timeouts and differing output fail the check.

The same fixture also runs separate construction-tool recovery and ground-pile ownership scenarios, with their own saves and replays. It requires actual returned tools, retained foreign ownership and clean accounting. These small headless scenarios complement browser input checks; they do not establish native game presentation.

Add `--browser` to repeat the comparison in a real browser through the installed Stacks CDP driver. The check serves the identical bundle on an automatically assigned loopback port, requires the full result without console or network errors, records the driver hash and stops its owned server afterward. It does not use the running application server.

The [macOS Craft 0.0.319 receipt](receipts/native-engine-cli-2026-10-24.json) ties the executed binary to its original verified publication and records matching checksums. A real browser also executed the identical bundle through the maintained Stacks CDP driver, producing the same result without console errors or failed requests. The latest local CLI receipt is written to `storage/framework/runtime/native-engine-receipt.json`. This check covers one headless fixture. It does not establish persistent native frame callbacks, native graphics or controls, browser presentation parity, or Gold Edition behavior. S3-023 and S3-092 remain open.

The additional `--staffing` probe retains a separate 5,000-tick construction, save and replay scenario. It is not qualified in Craft 0.0.341: the original native CLI exits with `uncaught error`, including when this scenario runs independently. Its initial world creation succeeds and the existing three-scenario probe succeeds. The longer failure is retained for the native hosting investigation; neither its cause nor sustained native gameplay is established. Do not shorten its tick window, raise the native guard or claim a pass from the browser result. Browser staffing qualification and this additional native execution result are recorded separately.
