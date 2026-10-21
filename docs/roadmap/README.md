# Settlers III Gold Edition roadmap

Master issue: https://github.com/stacksjs/the-settlers-iii-remake/issues/4

The approved scope is recorded in [specification.md](specification.md). Source ownership and release rules are in [upstream-workflow.md](upstream-workflow.md). Each implementation issue has a durable [draft](issues/) and a stable identifier. The JSON registry records actual GitHub URLs, database IDs, relationship results, and issue states; the catalog records behavior, acceptance, tests, and dependencies.

## Epics

- https://github.com/stacksjs/the-settlers-iii-remake/issues/5 - Original evidence and complete content
- https://github.com/stacksjs/the-settlers-iii-remake/issues/6 - True native foundations and upstream frameworks
- https://github.com/stacksjs/the-settlers-iii-remake/issues/7 - World, logistics, workers, and construction
- https://github.com/stacksjs/the-settlers-iii-remake/issues/8 - Complete civilian economy
- https://github.com/stacksjs/the-settlers-iii-remake/issues/9 - Military, religion, and all civilizations
- https://github.com/stacksjs/the-settlers-iii-remake/issues/10 - Ships, colonies, trade, and diplomacy
- https://github.com/stacksjs/the-settlers-iii-remake/issues/11 - Same-rules opponents and skirmish
- https://github.com/stacksjs/the-settlers-iii-remake/issues/12 - Original campaigns and map editing
- https://github.com/stacksjs/the-settlers-iii-remake/issues/13 - Original interface, animation, and sound
- https://github.com/stacksjs/the-settlers-iii-remake/issues/14 - Saves, replays, and multiplayer
- https://github.com/stacksjs/the-settlers-iii-remake/issues/15 - Reusable release, signing, credentials, and stores
- https://github.com/stacksjs/the-settlers-iii-remake/issues/16 - Performance, qualification, and finished release

## Implementation graph

| Stable ID | Source owner | Deliverable | Blocked by |
|---|---|---|---|
| [S3-001](https://github.com/stacksjs/the-settlers-iii-remake/issues/17) | stacksjs/the-settlers-iii-remake | Establish the Gold Edition fidelity specification | None |
| [S3-002](https://github.com/stacksjs/the-settlers-iii-remake/issues/18) | stacksjs/the-settlers-iii-remake | Build repeatable original-game observation fixtures | S3-001 |
| [S3-003](https://github.com/stacksjs/the-settlers-iii-remake/issues/19) | stacksjs/the-settlers-iii-remake | Establish licensed bundled-content provenance | S3-001 |
| [S3-004](https://github.com/stacksjs/the-settlers-iii-remake/issues/20) | stacksjs/the-settlers-iii-remake | Complete original graphics and animation importing | S3-003 |
| [S3-005](https://github.com/stacksjs/the-settlers-iii-remake/issues/21) | stacksjs/the-settlers-iii-remake | Complete original audio, text, font, and cinematic importing | S3-003 |
| [S3-006](https://github.com/stacksjs/the-settlers-iii-remake/issues/22) | stacksjs/the-settlers-iii-remake | Decode original maps and mission information | S3-001, S3-003 |
| [S3-007](https://github.com/stacksjs/the-settlers-iii-remake/issues/23) | stacksjs/the-settlers-iii-remake | Publish versioned rules and content catalogs | S3-002, S3-004, S3-005, S3-006 |
| [S3-008](https://github.com/stacksjs/the-settlers-iii-remake/issues/24) | stacksjs/the-settlers-iii-remake | Audit Craft, stx, and HomeOS execution evidence | None |
| [S3-009](https://github.com/craft-native/craft/issues/390) | craft-native/craft | Establish an executable graphics core and truthful capabilities | S3-008 |
| [S3-010](https://github.com/craft-native/craft/issues/391) | craft-native/craft | Implement textured sprites, terrain triangles, and text | S3-009 |
| [S3-011](https://github.com/craft-native/craft/issues/392) | craft-native/craft | Implement native Metal surfaces on macOS and iOS | S3-010 |
| [S3-012](https://github.com/craft-native/craft/issues/393) | craft-native/craft | Implement native Vulkan surfaces on Windows, Linux, and Android | S3-010 |
| [S3-013](https://github.com/craft-native/craft/issues/394) | craft-native/craft | Expose typed persistent JavaScript hosting | S3-009 |
| [S3-014](https://github.com/craft-native/craft/issues/395) | craft-native/craft | Unify native surface clocks and input | S3-011, S3-012, S3-013 |
| [S3-015](https://github.com/stacksjs/stx/issues/2108) | stacksjs/stx | Add a maintained native RenderSurface primitive | S3-014 |
| [S3-016](https://github.com/stacksjs/ts-css/issues/38) | stacksjs/ts-css | Support faithful native HUD styling | S3-015 |
| [S3-017](https://github.com/craft-native/craft/issues/396) | craft-native/craft | Harden native and browser checkpoint contracts | S3-013 |
| [S3-018](https://github.com/craft-native/craft/issues/397) | craft-native/craft | Complete native audio and content-import capabilities | S3-013 |
| [S3-019](https://github.com/stacksjs/stx/issues/2109) | stacksjs/stx | Verify native reactive HUD and event delivery | S3-015, S3-016 |
| [S3-020](https://github.com/stacksjs/stacks/issues/2957) | stacksjs/stacks | Build and package true native game applications | S3-017, S3-018, S3-019 |
| [S3-021](https://github.com/stacksjs/stacks/issues/2958) | stacksjs/stacks | Enforce source-first release and dependency evidence | S3-008 |
| [S3-022](https://github.com/stacksjs/the-settlers-iii-remake/issues/25) | stacksjs/the-settlers-iii-remake | Adopt verified published foundation releases | S3-017, S3-021 |
| [S3-023](https://github.com/stacksjs/the-settlers-iii-remake/issues/26) | stacksjs/the-settlers-iii-remake | Demonstrate the shared browser and native settlement | S3-020, S3-022 |
| [S3-024](https://github.com/home-lang/home-os/issues/114) | home-lang/home-os | Consume tested shared graphics primitives in HomeOS | S3-008, S3-010 |
| [S3-025](https://github.com/stacksjs/the-settlers-iii-remake/issues/27) | stacksjs/the-settlers-iii-remake | Introduce the deterministic game session and world model | S3-007 |
| [S3-026](https://github.com/stacksjs/the-settlers-iii-remake/issues/28) | stacksjs/the-settlers-iii-remake | Instantiate original terrain, elevation, and map geometry | S3-006, S3-025 |
| [S3-027](https://github.com/stacksjs/the-settlers-iii-remake/issues/29) | stacksjs/the-settlers-iii-remake | Implement individual settlers and spatial movement | S3-026 |
| [S3-028](https://github.com/stacksjs/the-settlers-iii-remake/issues/30) | stacksjs/the-settlers-iii-remake | Implement routing and dynamic obstruction recovery | S3-027 |
| [S3-029](https://github.com/stacksjs/the-settlers-iii-remake/issues/31) | stacksjs/the-settlers-iii-remake | Implement physical goods, piles, and bounded inventories | S3-025 |
| [S3-030](https://github.com/stacksjs/the-settlers-iii-remake/issues/32) | stacksjs/the-settlers-iii-remake | Implement real carrier delivery jobs | S3-028, S3-029 |
| [S3-031](https://github.com/stacksjs/the-settlers-iii-remake/issues/33) | stacksjs/the-settlers-iii-remake | Implement professions, tools, and worker assignment | S3-030 |
| [S3-032](https://github.com/stacksjs/the-settlers-iii-remake/issues/34) | stacksjs/the-settlers-iii-remake | Implement physical building construction | S3-026, S3-030, S3-031 |
| [S3-033](https://github.com/stacksjs/the-settlers-iii-remake/issues/35) | stacksjs/the-settlers-iii-remake | Implement construction suspension and demolition | S3-032 |
| [S3-034](https://github.com/stacksjs/the-settlers-iii-remake/issues/36) | stacksjs/the-settlers-iii-remake | Implement storage areas and transport priorities | S3-030, S3-032 |
| [S3-035](https://github.com/stacksjs/the-settlers-iii-remake/issues/37) | stacksjs/the-settlers-iii-remake | Implement residences and workforce allocation | S3-031, S3-032 |
| [S3-036](https://github.com/stacksjs/the-settlers-iii-remake/issues/38) | stacksjs/the-settlers-iii-remake | Implement exploration and player-specific visibility | S3-027 |
| [S3-037](https://github.com/stacksjs/the-settlers-iii-remake/issues/39) | stacksjs/the-settlers-iii-remake | Implement finite deposits, surveying, and terrain changes | S3-026, S3-031 |
| [S3-038](https://github.com/stacksjs/the-settlers-iii-remake/issues/40) | stacksjs/the-settlers-iii-remake | Implement territory and pioneer expansion | S3-027, S3-032 |
| [S3-039](https://github.com/stacksjs/the-settlers-iii-remake/issues/41) | stacksjs/the-settlers-iii-remake | Render actual simulation workers and cargo | S3-030, S3-032 |
| [S3-040](https://github.com/stacksjs/the-settlers-iii-remake/issues/42) | stacksjs/the-settlers-iii-remake | Prove world and logistics conservation | S3-033, S3-034, S3-035, S3-037, S3-038, S3-039 |
| [S3-041](https://github.com/stacksjs/the-settlers-iii-remake/issues/43) | stacksjs/the-settlers-iii-remake | Complete timber, forestry, sawmill, and stone production | S3-032, S3-037 |
| [S3-042](https://github.com/stacksjs/the-settlers-iii-remake/issues/44) | stacksjs/the-settlers-iii-remake | Complete food and water production | S3-041 |
| [S3-043](https://github.com/stacksjs/the-settlers-iii-remake/issues/45) | stacksjs/the-settlers-iii-remake | Complete mining and miner food preferences | S3-037, S3-042 |
| [S3-044](https://github.com/stacksjs/the-settlers-iii-remake/issues/46) | stacksjs/the-settlers-iii-remake | Complete iron, gold, and gem processing | S3-043 |
| [S3-045](https://github.com/stacksjs/the-settlers-iii-remake/issues/47) | stacksjs/the-settlers-iii-remake | Complete tools and weapons production | S3-031, S3-044 |
| [S3-046](https://github.com/stacksjs/the-settlers-iii-remake/issues/48) | stacksjs/the-settlers-iii-remake | Complete working-area and production controls | S3-034, S3-041, S3-042, S3-043 |
| [S3-047](https://github.com/stacksjs/the-settlers-iii-remake/issues/49) | stacksjs/the-settlers-iii-remake | Complete economic distribution controls | S3-045, S3-046 |
| [S3-048](https://github.com/stacksjs/the-settlers-iii-remake/issues/50) | stacksjs/the-settlers-iii-remake | Complete civilian specialist recruitment | S3-031, S3-038 |
| [S3-049](https://github.com/stacksjs/the-settlers-iii-remake/issues/51) | stacksjs/the-settlers-iii-remake | Implement truthful economy and settler statistics | S3-035, S3-047 |
| [S3-050](https://github.com/stacksjs/the-settlers-iii-remake/issues/52) | stacksjs/the-settlers-iii-remake | Prove a sustainable Roman settlement | S3-040, S3-045, S3-047, S3-049 |
| [S3-051](https://github.com/stacksjs/the-settlers-iii-remake/issues/53) | stacksjs/the-settlers-iii-remake | Implement barracks and individual recruitment | S3-035, S3-045 |
| [S3-052](https://github.com/stacksjs/the-settlers-iii-remake/issues/54) | stacksjs/the-settlers-iii-remake | Implement original troop selection and commands | S3-028, S3-051 |
| [S3-053](https://github.com/stacksjs/the-settlers-iii-remake/issues/55) | stacksjs/the-settlers-iii-remake | Implement individual combat and projectiles | S3-036, S3-044, S3-052 |
| [S3-054](https://github.com/stacksjs/the-settlers-iii-remake/issues/56) | stacksjs/the-settlers-iii-remake | Implement garrisons, capture, and territory consequences | S3-038, S3-053 |
| [S3-055](https://github.com/stacksjs/the-settlers-iii-remake/issues/57) | stacksjs/the-settlers-iii-remake | Implement healers, thieves, and specialist military interactions | S3-048, S3-053, S3-054 |
| [S3-056](https://github.com/stacksjs/the-settlers-iii-remake/issues/58) | stacksjs/the-settlers-iii-remake | Complete Roman religious and special production | S3-041, S3-044 |
| [S3-057](https://github.com/stacksjs/the-settlers-iii-remake/issues/59) | stacksjs/the-settlers-iii-remake | Implement temples, offerings, manna, priests, and promotions | S3-051, S3-056 |
| [S3-058](https://github.com/stacksjs/the-settlers-iii-remake/issues/60) | stacksjs/the-settlers-iii-remake | Complete the Roman faction and eight interventions | S3-007, S3-053, S3-057 |
| [S3-059](https://github.com/stacksjs/the-settlers-iii-remake/issues/61) | stacksjs/the-settlers-iii-remake | Complete the Egyptian faction | S3-007, S3-053, S3-057 |
| [S3-060](https://github.com/stacksjs/the-settlers-iii-remake/issues/62) | stacksjs/the-settlers-iii-remake | Complete the Asian faction | S3-007, S3-053, S3-057 |
| [S3-061](https://github.com/stacksjs/the-settlers-iii-remake/issues/63) | stacksjs/the-settlers-iii-remake | Complete the Amazon faction | S3-007, S3-053, S3-057 |
| [S3-062](https://github.com/stacksjs/the-settlers-iii-remake/issues/64) | stacksjs/the-settlers-iii-remake | Implement faction siege production and combat | S3-045, S3-053, S3-054 |
| [S3-063](https://github.com/stacksjs/the-settlers-iii-remake/issues/65) | stacksjs/the-settlers-iii-remake | Verify civilization-specific balance and terrain behavior | S3-044, S3-058, S3-059, S3-060, S3-061 |
| [S3-064](https://github.com/stacksjs/the-settlers-iii-remake/issues/66) | stacksjs/the-settlers-iii-remake | Prove complete warfare and religion scenarios | S3-055, S3-062, S3-063 |
| [S3-065](https://github.com/stacksjs/the-settlers-iii-remake/issues/67) | stacksjs/the-settlers-iii-remake | Implement shipyards, ship construction, and water routing | S3-026, S3-032, S3-045 |
| [S3-066](https://github.com/stacksjs/the-settlers-iii-remake/issues/68) | stacksjs/the-settlers-iii-remake | Implement ferries and colony establishment | S3-038, S3-048, S3-065 |
| [S3-067](https://github.com/stacksjs/the-settlers-iii-remake/issues/69) | stacksjs/the-settlers-iii-remake | Implement donkey breeding and marketplace routes | S3-034, S3-042, S3-048 |
| [S3-068](https://github.com/stacksjs/the-settlers-iii-remake/issues/70) | stacksjs/the-settlers-iii-remake | Implement docks and cargo shipping | S3-065, S3-067 |
| [S3-069](https://github.com/stacksjs/the-settlers-iii-remake/issues/71) | stacksjs/the-settlers-iii-remake | Complete diplomacy and interrupted trade recovery | S3-054, S3-066, S3-068 |
| [S3-070](https://github.com/stacksjs/the-settlers-iii-remake/issues/72) | stacksjs/the-settlers-iii-remake | Build an economic AI using player commands | S3-050 |
| [S3-071](https://github.com/stacksjs/the-settlers-iii-remake/issues/73) | stacksjs/the-settlers-iii-remake | Make AI recover from economic deadlocks | S3-047, S3-070 |
| [S3-072](https://github.com/stacksjs/the-settlers-iii-remake/issues/74) | stacksjs/the-settlers-iii-remake | Implement military and religious AI | S3-064, S3-070 |
| [S3-073](https://github.com/stacksjs/the-settlers-iii-remake/issues/75) | stacksjs/the-settlers-iii-remake | Implement naval and colony AI | S3-069, S3-071, S3-072 |
| [S3-074](https://github.com/stacksjs/the-settlers-iii-remake/issues/76) | stacksjs/the-settlers-iii-remake | Complete skirmish setup, difficulty, and random maps | S3-049, S3-071, S3-072, S3-073 |
| [S3-075](https://github.com/stacksjs/the-settlers-iii-remake/issues/77) | stacksjs/the-settlers-iii-remake | Implement a safe mission and objective runtime | S3-006, S3-025 |
| [S3-076](https://github.com/stacksjs/the-settlers-iii-remake/issues/78) | stacksjs/the-settlers-iii-remake | Complete tutorials and the Roman campaign | S3-050, S3-054, S3-057, S3-075 |
| [S3-077](https://github.com/stacksjs/the-settlers-iii-remake/issues/79) | stacksjs/the-settlers-iii-remake | Complete the Egyptian campaign | S3-059, S3-063, S3-075 |
| [S3-078](https://github.com/stacksjs/the-settlers-iii-remake/issues/80) | stacksjs/the-settlers-iii-remake | Complete the Asian campaign | S3-060, S3-063, S3-075 |
| [S3-079](https://github.com/stacksjs/the-settlers-iii-remake/issues/81) | stacksjs/the-settlers-iii-remake | Complete Mission CD campaign content | S3-076, S3-077, S3-078 |
| [S3-080](https://github.com/stacksjs/the-settlers-iii-remake/issues/82) | stacksjs/the-settlers-iii-remake | Complete both Amazon campaign paths | S3-061, S3-063, S3-075 |
| [S3-081](https://github.com/stacksjs/the-settlers-iii-remake/issues/83) | stacksjs/the-settlers-iii-remake | Build a native and browser map and scenario editor | S3-026, S3-075 |
| [S3-082](https://github.com/stacksjs/the-settlers-iii-remake/issues/84) | stacksjs/the-settlers-iii-remake | Verify all campaign progression and original media | S3-076, S3-077, S3-078, S3-079, S3-080 |
| [S3-083](https://github.com/stacksjs/the-settlers-iii-remake/issues/85) | stacksjs/the-settlers-iii-remake | Recreate the original control-center structure | S3-019, S3-025 |
| [S3-084](https://github.com/stacksjs/the-settlers-iii-remake/issues/86) | stacksjs/the-settlers-iii-remake | Complete building and economic inspection panels | S3-047, S3-057, S3-083 |
| [S3-085](https://github.com/stacksjs/the-settlers-iii-remake/issues/87) | stacksjs/the-settlers-iii-remake | Complete minimap, alerts, and original navigation | S3-036, S3-052, S3-083 |
| [S3-086](https://github.com/stacksjs/the-settlers-iii-remake/issues/88) | stacksjs/the-settlers-iii-remake | Match original terrain and entity presentation | S3-004, S3-010, S3-039 |
| [S3-087](https://github.com/stacksjs/the-settlers-iii-remake/issues/89) | stacksjs/the-settlers-iii-remake | Complete music, effects, ambience, and voice scheduling | S3-005, S3-018, S3-053 |
| [S3-088](https://github.com/stacksjs/the-settlers-iii-remake/issues/90) | stacksjs/the-settlers-iii-remake | Complete localization, accessibility, and touch controls | S3-084, S3-085, S3-086, S3-087 |
| [S3-089](https://github.com/stacksjs/the-settlers-iii-remake/issues/91) | stacksjs/the-settlers-iii-remake | Pass matched-scene visual and audio fidelity review | S3-002, S3-063, S3-088 |
| [S3-090](https://github.com/stacksjs/the-settlers-iii-remake/issues/92) | stacksjs/the-settlers-iii-remake | Implement complete versioned saves and migration policy | S3-025 |
| [S3-091](https://github.com/stacksjs/the-settlers-iii-remake/issues/93) | stacksjs/the-settlers-iii-remake | Make checkpoints survive lifecycle and storage failures | S3-017, S3-090 |
| [S3-092](https://github.com/stacksjs/the-settlers-iii-remake/issues/94) | stacksjs/the-settlers-iii-remake | Implement deterministic replay and state diagnostics | S3-013, S3-025 |
| [S3-093](https://github.com/stacksjs/the-settlers-iii-remake/issues/95) | stacksjs/the-settlers-iii-remake | Implement multiplayer sessions and content negotiation | S3-092 |
| [S3-094](https://github.com/stacksjs/the-settlers-iii-remake/issues/96) | stacksjs/the-settlers-iii-remake | Implement authoritative multiplayer simulation | S3-036, S3-093 |
| [S3-095](https://github.com/stacksjs/the-settlers-iii-remake/issues/97) | stacksjs/the-settlers-iii-remake | Implement reconnect, background recovery, and network saves | S3-090, S3-094 |
| [S3-096](https://github.com/stacksjs/the-settlers-iii-remake/issues/98) | stacksjs/the-settlers-iii-remake | Complete cross-platform multiplayer behavior | S3-069, S3-095 |
| [S3-097](https://github.com/stacksjs/stacks/issues/2959) | stacksjs/stacks | Complete encrypted production credential handling | S3-021 |
| [S3-098](https://github.com/stacksjs/stacks/issues/2960) | stacksjs/stacks | Reconcile Apple signing and provisioning resources | S3-097 |
| [S3-099](https://github.com/stacksjs/stacks/issues/2961) | stacksjs/stacks | Complete reusable iOS App Store delivery | S3-020, S3-098 |
| [S3-100](https://github.com/stacksjs/stacks/issues/2962) | stacksjs/stacks | Implement reusable Android and Google Play delivery | S3-020, S3-097 |
| [S3-101](https://github.com/stacksjs/stacks/issues/2059) | stacksjs/stacks | Complete desktop signing and distribution | S3-020, S3-098 |
| [S3-102](https://github.com/stacksjs/the-settlers-iii-remake/issues/99) | stacksjs/the-settlers-iii-remake | Prepare verified store content and declarations | S3-003, S3-089 |
| [S3-103](https://github.com/stacksjs/stacks/issues/2963) | stacksjs/stacks | Unify release orchestration and receipts | S3-099, S3-100, S3-101, S3-102 |
| [S3-104](https://github.com/stacksjs/the-settlers-iii-remake/issues/100) | stacksjs/the-settlers-iii-remake | Establish large-world and native performance budgets | S3-023, S3-040, S3-064, S3-069 |
| [S3-105](https://github.com/stacksjs/the-settlers-iii-remake/issues/101) | stacksjs/the-settlers-iii-remake | Execute the complete platform and campaign matrix | S3-082, S3-089, S3-091, S3-096 |
| [S3-106](https://github.com/stacksjs/the-settlers-iii-remake/issues/102) | stacksjs/the-settlers-iii-remake | Verify untrusted input and release security | S3-006, S3-090, S3-094, S3-103 |
| [S3-107](https://github.com/stacksjs/the-settlers-iii-remake/issues/103) | stacksjs/the-settlers-iii-remake | Qualify and publish the finished Gold Edition release | S3-103, S3-104, S3-105, S3-106 |

## Publish and verify

Run `bun scripts/roadmap.ts --check` to validate and render local drafts. Run `bun scripts/roadmap.ts --publish` to reconcile the authorized GitHub graph. Run `bun scripts/roadmap.ts --verify` to read back issues and verify relationships. Publishing resumes from stable remote markers and preserves adopted issue content. It never closes implementation issues.
