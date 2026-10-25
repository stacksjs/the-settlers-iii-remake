# M0 execution receipt

Recorded 2026-10-24. This receipt separates source implementation, package publication, downstream installation, and demonstrated game behavior. Pending gates remain pending.

## Current checkpoint

The game installs Stacks **0.75.294**, all six STX packages **0.2.686**, Craft **0.0.330**, Pantry **0.11.126**, and Bun **1.4.4** through normal installers. The [installed-consumer receipt](receipts/framework-0.75.294-receipt.json) verifies all 95 installed package trees against original public archives, exact source and release jobs, and seven passing application checks. Application framework declarations pin the qualified release so a later unqualified version cannot enter through a workspace range.

The [framework publication](receipts/framework-0.75.294-publication.json) retains verification of 86 original npm archives, all five original native archives, and execution of the original ARM64 Buddy binary. This release was cut independently; the receipt does not claim this chat executed that release command. The retained upstream plans identify the original Pantry, Pickier, STX and Craft publications. Later releases require their own qualification before adoption.

Craft 0.0.330 has [complete native Metal publication evidence](receipts/native-metal-0.0.330-publication.json): exact source and release gates, original public package consumption, one actual macOS native UI test, two actual iOS native tests, and six personally inspected captures. The original native tests cover changing frames, pixel comparisons, scale, resize, suspension/resume, ownership and disposal. These are maintained Metal surface fixtures. They do not establish native game rendering, persistent game frame callbacks, a native HUD, or Gold Edition parity. [Hosted downstream acceptance](receipts/framework-0.75.294-hosted-ci.json) also passed with the original diagnostic artifact independently verified. S3-011 is completed.

The [shared-engine receipt](receipts/native-engine-cli-0.0.330.json) records the original Craft 0.0.330 executable resolved through the installed SDK and normal PATH. The same bundled five-tick save/restore/replay fixture produces checksum `c331a944` in Craft, Bun and a real browser, with zero browser console or network errors. This headless execution does not establish native presentation.

A local installation mistake was rejected by the full byte verifier: a manifest traversal followed the defaults symlink and left an old nested manifest in the installed package. Removing that owned installation and running a normal frozen install restored the original package. The complete unmodified verifier then passed. No altered installed runtime or weakened verification is used by this adoption.

The supplied remake repository and public demo remain the available implementation reference. No original Gold executable or original execution captures are available. Exact timing, balance, physical logistics, all original campaigns and redistribution rights remain unverified. The browser game remains a custom prototype; all 120 roadmap slots are tracked, with completion governed by their individual acceptance evidence.

## Atomic checkpoint session evidence

The [atomic session receipt](receipts/checkpoint-atomic-sessions-2026-10-24.json) records the source correction at `10c5681e`: conflicting contexts cannot both acknowledge the same checkpoint, stale loaded game state cannot overwrite newer progress, and disposal stops subsequent migration reads. All 21 checkpoint tests passed with 77 assertions. Two real browser contexts exercised the unchanged installed Craft browser storage provider with native Web Locks and localStorage. The production campaign retained all 58 steps. Both exact-source and main-branch hosted CI passed. This supersedes the earlier two-slot coordinator implementation while retaining its original evidence. Native game lifecycle acceptance remains open.

The later [load/save ordering receipt](receipts/checkpoint-load-save-order-2026-10-24.json) adds one shared queue for checkpoint reads and writes. A delayed load can no longer rewind an acknowledged save base, and saves coalesce only between load boundaries. All 24 checkpoint cases, all 242 application tests, the real two-context browser test through generation 5, and the 58-step production campaign passed. Disposal rejects queued reads without starting storage work. Native game lifecycle acceptance remains open.

## Browser resize evidence

The [browser resize receipt](receipts/browser-resize-2026-10-24.json) records two real-browser failing reproductions and the renderer correction. Resizing preserves the world point at the centre of the view, and hiding the canvas retains its last visible geometry. The running production game passed three size transitions and a hide/show cycle with all 36,864 sampled centre channels identical at every visible size. The original-media capture was inspected locally. The regression now runs in CI alongside the production campaign. This advances the browser portion of S3-088; localization, complete touch controls and native acceptance remain open.

The application also removes its inherited `stx` script alias. Before correction, `bun run stx --version` invoked Buddy 0.75.294; afterward it resolves the installed STX 0.2.686 compiler. A normal frozen install leaves all 200 installations unchanged. The owning framework correction is [4bdb0958](https://github.com/stacksjs/stacks/commit/4bdb0958363b9bc6ec61e5faa1d01711c2a61e34), with its public CLI regression and generated native catalog integrated on main at [0941476a](https://github.com/stacksjs/stacks/commit/0941476a0cd5d81a0244bee127fc96f044ad7cbe). The complete [main framework CI](https://github.com/stacksjs/stacks/actions/runs/40158423148), including deployment, passed. This application correction changes no installed framework bytes or dependency pins.

## Browser production evidence

The [browser production receipt](receipts/browser-production-2026-10-24.json) records 19 actual browser steps: build a sawmill through the controls, wait for its sawyer and full output, inspect production accounting, save, reload and verify the retained figures. Construction consumes three planks and four stones; eight starting logs become eight new planks, leaving 35 planks in the settlement. Output stops at the bounded doorstep. The visible production statistics report these exact quantities before and after reload, with no browser console or network errors. The production raster was inspected locally. CI now repeats this scenario alongside the campaign, control-frame, resize and checkpoint checks. This proves one supplied production chain under the engineering profile, not a complete sustainable economy or original numeric rules.

## Historical roadmap snapshot

[Master issue #4](https://github.com/stacksjs/the-settlers-iii-remake/issues/4) links 12 epics and 107 implementation slots. The existing [Stacks desktop distribution issue #2059](https://github.com/stacksjs/stacks/issues/2059) is adopted for S3-101. Its authored content is preserved. Actual identities, labels, milestones, parent relationships, and blocking edges are recorded in [github.json](github.json).

All 120 entries passed live read-back verification of identities, labels, milestones, acceptance criteria, frontier labels, and recorded native relationships. The publisher has retained subprocess evidence for an interrupted create response, recovery without duplicates, authored metadata and parent preservation, denied relationship reads, repeat reconciliation, and read-back verification. Campaign issues contain explicit unchecked mission ledgers. [evidence.md](evidence.md) pins the preserved original manual and its hashes.

There are 119 native parent links and 239 native blocker links, with no rejected relationships. S3-001 and S3-008 are completed with retained evidence; S3-002 and S3-003 are partially implemented, and S3-009 and S3-021 still require complete release and adoption evidence. A blocker closed as not planned does not unlock dependent work. This lifecycle is covered by a 54-assertion subprocess regression that also fails against the prior publisher. The initial roadmap commit passed [GitHub CI](https://github.com/stacksjs/the-settlers-iii-remake/actions/runs/39637794745), including production browser acceptance.

## Initial owning source changes

| Owner | Implementation evidence | Release/adoption status |
|---|---|---|
| Craft | [86daaf53ab61e9319b63fcbe65952c20b8d3b270](https://github.com/craft-native/craft/commit/86daaf53ab61e9319b63fcbe65952c20b8d3b270): truthful graphics capabilities, unsupported-operation errors, bounded RGBA atlas composition, actual pixel and allocation-failure tests. Platform test linking corrected while integrating current upstream. | `v0.0.278` tagged at `2d5ba22e11c5d5f86a9ba72d38d61cb0a8730043`; [release](https://github.com/craft-native/craft/actions/runs/39632738974) still gated. |
| stx | [fefd06b9e75e679ab2f57724e58f5cb8c7079a62](https://github.com/stacksjs/stx/commit/fefd06b9e75e679ab2f57724e58f5cb8c7079a62): native document visibility follows Craft lifecycle so imported animation clocks pause, resume with zero delta, and dispose correctly. Existing browser documents retain their behavior. | [v0.2.638 published](https://github.com/stacksjs/stx/releases/tag/v0.2.638) at `7a0f6f4b8b81aa1927f267fb5018f33c07d397cf`. Exact-source and npm gates passed; six public packages, SHA512 tarballs, clean/frozen consumer installation, and compiled-native VM lifecycle passed. [Receipt](receipts/stx-0.2.638.json). Optional icon generation was still running when recorded. |
| Stacks | [3ef1819b2c](https://github.com/stacksjs/stacks/commit/3ef1819b2cc92a0798900940bd2bc4c2e1d4458f): report effective native build sources with credential/query redaction. [abc7e488ae](https://github.com/stacksjs/stacks/commit/abc7e488ae5c9e3705285ade582d52b777bd2f0e): atomic private key bootstrap/update and exact stdin secret input. [ede9288a1d](https://github.com/stacksjs/stacks/commit/ede9288a1d): selected-environment CI key detection and rejection of unrelated/empty keys. | Tested source integrated and pushed at `031f394ed991c0d342bca2d2491332ae1ada29b7`. Dependency adoption and patch release await verified Craft/stx publication. |

Commits created for this execution use Chris attribution without coauthor trailers. Existing primary checkouts and unrelated work are preserved.

## Initial retained source checks

- Craft: 30 GPU tests and 47 renderer tests inspect actual results; 756 SDK tests; type/build/package checks including extracted-archive imports; 197/197 pinned-toolchain native build steps. A filesystem-watch timing failure passed on focused rerun. Remote native/mobile acceptance and actual public artifacts remain separate gates.
- stx: 16,771 tests passed with four explicit existing skips and zero failures; 782 native tests; focused post-merge checks; compiler/type/export/installed-package preflight. Lint has zero errors and 254 existing warnings. Public tarball integrity and installed compiled-native lifecycle checks passed. This executes a compiled bundle in a JavaScript VM with controlled host timers; it is not UIKit/device or native game presentation evidence.
- Stacks: frozen installation, full framework types, actions/Buddy builds, native documentation checks, and lint with zero errors and six existing warnings. The integrated broad actions/env/Buddy run passed 2,580 tests; six existing time-budget tests timed out under host contention, then all six passed unchanged with their original budgets in focused reruns. No failing check was suppressed or changed to pass.

## Downstream and production checks

Current package adoption and local regression results are recorded in the current checkpoint. Final framework/native adoption, encrypted production bootstrap, protected CI decryption, and final lockfile evidence remain pending. The existing game baseline remains the browser prototype described in [specification.md](specification.md).

## Initial capability gaps (historical)

These corrections do not complete native window presentation, fonts/text, terrain triangles, typed retained game hosting, RenderSurface/HUD delivery, original physical logistics, Gold campaigns, multiplayer, signing, or store submission. The corresponding implementation issues remain open. HomeOS shared-core adoption also remains open and independent of supported game platforms. Original-content redistribution rights are unverified and continue to block bundled release.
