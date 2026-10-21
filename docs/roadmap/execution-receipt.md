# M0 execution receipt

Recorded 2026-10-21. This receipt separates source implementation, package publication, downstream installation, and demonstrated game behavior. Pending gates are not successful releases.

## Current checkpoint

This checkpoint supersedes the initial release statuses retained below.

- S3-001 is completed with [validated edition profiles](receipts/S3-001.md). S3-002 has a [partial observation harness](receipts/S3-002.md), with no executed original observation or independent repeat. S3-003 has [converted-content provenance](../content/provenance.md), with zero redistribution grants. Both partial issues remain open.
- The PNG allocation defect was fixed at `stacksjs/ts-png@96416a8b517bef4059fe3dc0dff80681243c7557` and released through its existing command as `0.1.10`, release commit `ea287d4f56be610578a9e0be9a8ba23f4bfd81be`. Source CI, release CI and publication passed. The game consumes that exact package; its [receipt](receipts/S3-002-png-adoption.json) retains original release integrity, verified registry signatures and all 29 installed files.
- Stacks adopted six published stx `0.2.644` packages from source `3902759748e23b8ac035642c5468d25af8e7875a`. The full release workflow passed. [Framework adoption evidence](https://github.com/stacksjs/stacks/blob/main/docs/guide/buddy/receipts/stx-0.2.644-receipt.json) matches actual archive and installed bytes and records frozen-lock compatibility and stx view checks. The game still consumes its prior framework/stx versions until a verified Stacks release is available.
- Stacks source `51f8f528b78aab347a23258caa9f79f85bb2ee46` adds exact source/archive/consumer verification, mandatory application publication policy, fail-closed deployment hooks and owned check-process cleanup. Its [full CI](https://github.com/stacksjs/stacks/actions/runs/39680656420) is pending. Local verification passed 49 focused tests with 135 assertions, full framework types, actions/Buddy builds, eight pinned documentation checks and Pickier with zero errors and six existing warnings. No Stacks package publication or game adoption is claimed for this source yet.
- Craft graphics/resource corrections are on main, with the existing release command producing `v0.0.282` at `7c5602d96a7dd40871b89dddb45ebd56bae92c2b`. The [release](https://github.com/craft-native/craft/actions/runs/39676457978) passed 15 checks when recorded; macOS source and exact native acceptance remain pending. Package publication, downstream adoption and native game presentation remain unverified.
- Combined game checks passed a frozen Bun 1.4.2 install, all three type pipelines, Pickier with zero issues, 47 unit tests and 2,636 assertions, and actual conversion/verification of 103 sprite frames, six PCM sounds and 24 files. These are private development checks. All six bundled publication channels refuse missing rights evidence. The preceding S3-003 integration also passed its production browser campaign and [hosted CI](https://github.com/stacksjs/the-settlers-iii-remake/actions/runs/39679885271).

The source/reference evidence does not establish original timing, balance, physical logistics, combat or campaign parity. The rendered game remains a custom browser prototype. Original media, a successful build and byte-identical conversion do not supply redistribution permission.

## Roadmap

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

## Remaining capability gates

These corrections do not complete native window presentation, fonts/text, terrain triangles, typed retained game hosting, RenderSurface/HUD delivery, original physical logistics, Gold campaigns, multiplayer, signing, or store submission. The corresponding implementation issues remain open. HomeOS shared-core adoption also remains open and independent of supported game platforms. Original-content redistribution rights are unverified and continue to block bundled release.
