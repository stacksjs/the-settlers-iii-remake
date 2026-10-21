# Settlers III Gold Edition implementation specification

Approved 2026-10-21. This specification records the user's accepted plan. The catalog and per-issue drafts provide the complete acceptance and dependency graph.

## Product and finish line

- Reproduce Gold Edition behavior: original base game, Mission CD, and Amazons, with all civilizations, original campaigns, skirmish, map editing, logistics, combat, religion, ships, trade, presentation, and audio.
- Deliver browser, macOS, Windows, Linux, iOS, and Android. Native gameplay and HUD use true native rendering through Craft and stx, without a WebView dependency.
- Support authoritative cross-platform multiplayer using a new protocol. Legacy original-game and JSettlers network interoperability are outside this scope.
- Bundle original content only with recorded redistribution evidence. The source-code license and a publicly downloadable demo do not establish those rights.
- Release for free without ads or in-app purchases. Include App Store and Google Play delivery through reusable Stacks release automation.

## Architecture and public contracts

One browser-independent TypeScript simulation advances integer ticks from ordered commands, seeded randomness, and stable entity ordering. Goods, workers, tools, cargo, reservations, inventories, construction, and armies are actual world state. Settlement totals are derived views. Rendering interpolation never changes simulation outcomes.

The game-session interface accepts commands, advances ticks, reads a player view, saves, restores, and disposes. Versioned save envelopes retain rules/content versions and complete jobs, cargo, inventories, randomness, mission state, and timers. Preserve existing prototype saves rather than reinterpreting them as original-game saves.

Craft owns a bounded platform-independent 2D graphics core, native presentation, retained JavaScript hosting, input, audio, files, storage, and lifecycle. Metal serves Apple hosts and Vulkan serves the other native hosts. stx owns the maintained RenderSurface primitive and shared reactive HUD. ts-css owns shared styling semantics. Render adapters consume the same scene decisions, projection, asset handles, animation state, ordering, and normalized input. Unsupported paths return explicit errors.

A retained native JavaScript realm loads the shared bundle and exchanges typed buffers and callbacks with bounded ownership. Keep existing maintained native host engines. Do not evaluate generated source for every input or frame. Do not introduce a second signals runtime.

Online matches run authoritatively in Bun. Validate identity, command order, ownership, costs, rates, versions, and tick scheduling server-side. Emit visibility-filtered updates so clients do not receive concealed enemy state. Replays retain ordered commands and checksums for the first divergent tick.

HomeOS is a source-reuse opportunity, not a game platform prerequisite. Extract only evidenced portable operations into the Craft core, preserving notices. A Home consumer must pass executed ABI, ownership, pixel, and graphical integration tests. Kernel boot and parse coverage do not prove compositor or GPU execution.

## Fidelity evidence

Original observations and manuals govern game behavior. Pin edition, revision, starting conditions, commands, timings, output, and asset hashes. JSettlers is engineering evidence, not proof of original values: its pinned movable definitions explicitly change movement speed, and its catalogs omit some original functionality. Never infer a fidelity percentage from passing prototype tests.

[evidence.md](evidence.md) records the immutable preserved-manual revision and file hashes used by the issue catalog. Rendered manual links below are reading conveniences; the revised manual still requires edition-specific observations.

The [detailed fidelity contract](../fidelity/gold-edition-specification.md) defines evidence classes, edition profiles, domain invariants, the full issue-to-system inventory, and unresolved numeric rules. It is a draft for S3-001; exact original builds and their applicability remain unverified.

Each campaign has a per-mission table covering original identifier, starting state, objectives, special triggers, briefing/media, save/load, failure, victory, progression, and evidence. Loading terrain or reaching a generic victory does not finish a mission.

## Baseline

At game revision `884406e97f912d18a50a33734b535a27dd25531d`, lint, application/tools/template type checks, 17 unit tests, asset verification, production build, and the Chrome campaign scenario passed. The scenario covers keyboard construction, speed, pause, audio, background save, and reload. The current simulation still has shared global stock, decorative carriers, numeric population/armies, simplified construction, and a custom Riverlands campaign.

The source audit found real tested CPU pixels for Craft clear/rectangles/circles/lines, but no-op text and false-success GPU draw/shader paths. Existing stx native UIKit evidence proves a native control slice, not a game-rendering surface. HomeOS has executed kernel/framebuffer evidence, while the audited compositor/Craft GPU bridge lacks demonstrated graphical execution. Record later evidence in receipts rather than silently rewriting this baseline.

## Delivery gates

| Gate | Required outcome |
|---|---|
| M0 | Published issue graph, retained source reproductions, tested upstream fixes and verified downstream packages |
| M1 | Real people, tools, goods, transport, construction, storage, and sustainable Roman production |
| M2 | Individual combat, capture, specialists, religion, all civilizations, and siege |
| M3 | Ships, colonies, same-rules AI, skirmish, editor, and all original campaigns |
| M4 | Original presentation, complete saves, true native rendering, and measured host parity |
| M5 | Authoritative multiplayer, signed distributions, store delivery, and reusable release automation |
| M6 | Fidelity, rights, performance, security, install/update, actual store availability, and recovery evidence |

Work the actual issue frontier rather than imposing whole-epic dependencies. The first execution publishes the graph and repairs verified foundations. Partial native work remains open until actual frames, input, HUD, save/load, lifecycle, and cross-host checksums are demonstrated.

## Verification

Use owning-repository lint/type/tests, source regressions, published-package consumer smoke tests, actual native screenshots/input, deterministic simulation fixtures, goods/people conservation, complete mid-job saves, campaign tables, dense-world and thermal measurements, untrusted-input fuzzing, signing/install/update checks, and actual store processing receipts.

The game retains `./buddy lint`, `bun run typecheck`, appropriate `./buddy test` suites, asset verification, production build, and production browser/native scenarios. Use pickier, stx, ts-css, explicit module imports, and native framework capabilities. No runtime shims, copied framework implementations, node_modules patches, generated-source string rewriting, false-success operations, or skipped release gates.

## Primary sources

- [Reference source, pinned](https://github.com/paulwedeck/settlers-remake/tree/6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0)
- [Original economy](https://settlers.jakelee.co.uk/en/ec_basic/basics.htm)
- [Original construction and faction costs](https://settlers.jakelee.co.uk/en/ec_build/building.htm)
- [Original military and religion](https://settlers.jakelee.co.uk/en/military/military.htm)
- [Original trade](https://settlers.jakelee.co.uk/en/ec_trade/trade.htm)
- [Edition changes](https://settlers.jakelee.co.uk/en/changes/changes.htm)
- [Existing fidelity audit](../fidelity-audit.md)
