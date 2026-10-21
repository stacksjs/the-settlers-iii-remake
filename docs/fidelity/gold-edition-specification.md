# Gold Edition fidelity contract

Draft for S3-001, reviewed against preserved sources on 2026-10-21. **S3-001 remains open.** The supported scope is enumerated below, but original executable identities, patch applicability, and the complete original content manifest are not yet established. No original executable was run for this document. No row implies implemented gameplay or permission to redistribute content.

## Evidence vocabulary and authority

Every assertion uses one of these classes. A manual statement is evidence of documentation, not an observed runtime result.

| Class | Meaning | Admission rule |
|---|---|---|
| M | Original manual statement, preserved in a third-party archive | Cite the exact pinned file and section. Edition applicability can still be U. |
| O | Repeatable original-executable observation | Name the executable/content hashes, profile, fixture, commands, outcome and retained capture. There are no O claims in this draft. |
| E | Approved engineering or product decision | Trace to the [approved specification][P] and [107-entry catalog][C]. Never present it as original behavior. |
| U | Unverified, conflicting, or incompletely inventoried | Name the missing evidence and owning issue. Do not populate a production rule with a guessed value. |

The archive revision `8426388935b436e65b0697ac401c4247ab097364` pins the preserved manual bytes. It does not identify the original retail executable, a patch version, or the historical distribution containing those bytes. All eight inspected raw files were fetched again and matched the SHA-256 values in the [manual evidence snapshot][H]. **M:** the changes page describes a revised manual with changes since the original release. **U:** its applicability to every original build is unresolved; one universal rules profile cannot be inferred from it. [Manual revision notice][M-CH]

**E policy:** resolve original behavior against the intended original build. Record a manual/runtime discrepancy before choosing a behavior; an implementation preference cannot silently resolve it. JSettlers at `6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0` is a comparator and importer research source. Its README acknowledges control differences from the original. Its source, tests, and asset-loading instructions do not constitute original-executable observations or redistribution evidence. [P], [pinned reference README][R]

## Edition and revision matrix

The names B, M, A and G below are planning profile keys, **E**, not original executable identifiers. Exact versions must be recorded before claiming that a fixture proves an edition's behavior.

| Profile | Documentary distinction | Approved content target | Revision and applicability still U |
|---|---|---|---|
| B: base game | **M:** the manual distinguishes the original CD and describes Roman, Egyptian and Asian campaign choices. [Preparation][M-PR] | **E:** base tutorials, campaigns, maps, factions and their systems. [P] | Retail/reissue locale, executable version/hash, patch lineage, original manual edition, map/media manifest and behavior before later changes. |
| M: Mission CD | **M:** a separate CD and second campaign are identified; editor access is associated with Mission CD/Amazon CD. [Preparation][M-PR] | **E:** all Mission CD missions, maps and applicable rule additions, alongside the base content. [P] | Standalone versus combined installation, executable/data changes, exact additions, compatibility with base saves/maps, faction availability by installed combination. |
| A: Amazons | **M:** the Amazon CD has the Amazon and Three Gods campaign paths. The building-material table includes Amazons separately. [Preparation][M-PR], [buildings][M-BU] | **E:** Amazon faction, both paths, applicable expansion systems and media. [P] | Executable patch identity, inherited changes to other factions, standalone versus combined installation, original campaign/map IDs and revisions. |
| G: remake Gold target | **E:** base + Mission CD + Amazons are all required. [P] | A complete supported content set with explicit rules/content versions. | Which original Gold distribution and patch supplies the default rules baseline. The preserved manual does not identify that binary. Do not invent a fourth original ruleset or silently mix incompatible revisions. |

For each original profile instance, S3-001/002 must record distribution/edition name, installed expansion set, language, displayed version, executable SHA-256, data archive/file hashes, installed patch evidence, relevant manual revision, and capture environment. A patch label without bytes is insufficient. A content pack's presence does not prove that its rule changes are active.

Revision-sensitive rules remain separate until evidence establishes equality. A shared definition needs a reason and evidence for every profile using it. If a later edition changes a rule, retain both original results and select explicitly by rules version; do not overwrite the earlier fixture.

## Small set of documentary anchors

These statements justify the first observation targets. They do not establish timings, complete catalogs or applicability to every profile.

| Claim | Documented fact | Implementation consequence and unresolved portion |
|---|---|---|
| M-01 | Carriers transport materials, and accumulating output can stop production. Construction delivery precedes storage delivery. [Economy][M-EC] | **E:** goods and delivery must be physical state. **U:** scheduling ties, exception cases, travel costs and per-revision limits. |
| M-02 | Diggers level construction sites; builders and diggers require tools. [Economy][M-EC], [occupations][M-JO] | **E:** site work, staffing and tools cannot be numeric shortcuts. **U:** exact work rates, allocation and interrupted work rules. |
| M-03 | The manual distinguishes faction building materials and finite stone from tree production; working areas can be changed. [Buildings][M-BU] | **U:** exact footprint/cost tables and production cycles must be transcribed, reconciled and observed per profile. |
| M-04 | Recruiting requires an available settler, weapon and barracks. Promotion affects subsequently recruited soldiers; existing soldiers keep their rank. [Military][M-MI] | **E:** rank belongs to an individual unit. **U:** precise thresholds, costs, timing, combat and faction exceptions. |
| M-05 | Trade exchanges goods between human players; transport can supply another colony by land or sea. Computer opponents cannot trade under the documented rules. [Trade][M-TR] | **E:** distinguish inter-player trade from own-colony transport. **U:** protocol, route and interruption details. AI colony transport does not imply AI trading. |
| M-06 | The screen distinguishes overview, control, information and playing areas, with building/goods/settler controls. [Menus][M-ME] | **E:** preserve this information hierarchy as the default. **U:** complete interactions, exact keyboard behavior, visual measurements and localized strings. |
| M-07 | The revision index calls out Amazons, trade, thieves, economic mode and clan/ladder changes. [Changes][M-CH] | **U:** it is not a complete patch changelog and does not assign all changes to exact executable versions. |

## Domain terms and state invariants

These are **E** definitions for the shared simulation contract, grounded in the approved architecture [P]. They specify what tests must be able to observe, without prescribing internal classes or claiming original data structures.

| Term | Meaning and invariant |
|---|---|
| Rules profile | A named set of evidenced rules for a specific edition/revision. Content profile separately identifies data and localization. Both travel with saves, replays and network compatibility. |
| Good | A quantity of a particular resource with an owner and physical location: world pile, inventory or cargo. Settlement totals are derived. An internal transfer changes location, never quantity. |
| Reservation | An exclusive claim on available goods or capacity for a job. It does not create goods, deliver them, or transfer ownership. Completion/cancellation releases it exactly once. |
| Inventory and pile | Bounded storage with supported goods and explicit location. Limits are rules data, not renderer assumptions. Full output prevents otherwise eligible work from producing more output. |
| Settler and occupation | An individually identified person with location, owner and action state. Assigning a profession or recruiting does not duplicate that person. Required tools/weapons have a corresponding accounted-for transition. |
| Job | An assignment connecting worker, source, destination, reservations and progress. Accepted, interrupted, cancelled and completed results are distinguishable. Unreachable work cannot teleport cargo or retry forever without a diagnosable state. |
| Construction site | A reserved footprint and work in progress. Completion follows delivered requirements and actual work. Suspension, demolition and capture resolve every worker, material and reservation using the evidenced profile. |
| Territory | Spatial ownership used by placement, capture and movement rules. It is distinct from exploration and visibility. Border changes cannot erase accounted-for entities without an explicit rule. |
| Player view | Information a player is permitted to know. UI, AI and network clients consume this boundary. Hidden authoritative state is not sent to a client and merely hidden in its HUD. |
| Mission state | Objective/trigger progress, pending events, timers, branch/unlock state and outcome. An imported map is not a completed mission implementation. |
| Simulation tick | Ordered state advancement independent of drawing. Same profile, content, seed, commands and initial state produce the same state checksum. Interpolation and sound playback do not change simulation results. |
| Checkpoint | A complete versioned state committed atomically. A successful request means durable completion. Failure preserves the last valid checkpoint and reports the failure. |

For each good kind, end quantity equals start quantity plus recorded production/import/scenario creation, minus recorded consumption/export/destruction. Internal deliveries, reservations and ownership transfers contribute zero net creation. A theft or captured shipment changes ownership consistently. Every birth, death, recruitment, profession change and embarkation has an explicit person-state transition. This accounting is a test oracle, not a claim that goods or population totals stay constant during production or combat.

Save/restore must preserve jobs, paths or enough deterministic routing state to resume them, cargo, tool commitments, inventories, reservations, random-generator state, timers, mission progress, visibility and ordered commands. Mid-delivery, mid-build, mid-combat, mid-voyage and mid-trigger saves are distinct required cases. Prototype saves retain their existing identity and cannot be silently interpreted as faithful saves. [P]

## Required systems and content inventory

All rows below are **E scope contracts** from [P] and [C], not assertions that an original feature is already verified or implemented. Together they map every S3-001 through S3-107 slot exactly once. Manual links identify documentary starting points; original IDs, complete media lists and numeric rules remain U until the relevant evidence/import tickets resolve them. An imported asset does not prove its associated gameplay.

| IDs | Contract boundary and required inventory | Evidence to retain |
|---|---|---|
| S3-001..S3-003 | Rules profiles, repeatable original observations, and redistribution provenance for each edition, language and content category. | Edition/build identities; claim ledger; separate rights/channel evidence. [M-CH], [P] |
| S3-004 | Terrain, buildings/stages, workers/professions, cargo, troops, ships, siege, effects, directions, anchors, shadows and player-color graphics. | Original file/frame identifiers, decoded hashes, malformed-input receipts, coverage gaps. [C] |
| S3-005 | Sound effects, ambience, music, voice, text, fonts, cinematics and localization mappings. | Per-file provenance and codec/localization inventory, missing-item diagnostics. [C] |
| S3-006 | Original maps and mission records: terrain/elevation, players, entities, resources, piles, objectives, hints and version differences. | Original IDs/hashes, parser coverage and unsupported-record diagnostics. [C] |
| S3-007 | Immutable rules and content catalogs, including faction-specific definitions and compatibility identities. | Every required catalog row links a claim, source, applicable profile and asset/rule digest. [C] |
| S3-008..S3-010 | Framework evidence, tested graphics primitives, sprite/terrain/text output and truthful capabilities. | Actual pixels and errors, bounded allocation/ownership, source provenance. [P] |
| S3-011..S3-014 | Native Metal/Vulkan presentation, retained typed JavaScript hosting, clocks, input and lifecycle. | Presented frames and input on each required host; suspension, resize, scale, disposal and device-error evidence. [P] |
| S3-015..S3-019 | Shared stx surface/HUD, ts-css semantics, checkpoint completion, native audio/content storage and reactive delivery. | Native mounting, controls, module imports, cancellation and resource cleanup through maintained interfaces. [P] |
| S3-020..S3-024 | Native packaging, source-first releases, published adoption, shared browser/native settlement and proven HomeOS reuse. | Installed artifacts and matching simulation state; HomeOS ABI/pixel/integration evidence remains an independent reuse gate. [P] |
| S3-025..S3-028 | Deterministic sessions, original geometry/elevation, individual settlers, movement and obstruction recovery. | Ordered command fixtures, picking/projection checks, route changes and unreachable outcomes. [C] |
| S3-029..S3-031 | Goods/piles/inventories, real carriers, tool-dependent professions and assignment. | No delivery before arrival; no double reservation, duplicate good/person or capacity overflow. [M-EC], [M-JO] |
| S3-032..S3-035 | Physical construction, pause/demolition, storage/priorities, residences and workforce allocation. | Mid-job interruption, material/work prerequisites, saturation and explicit population transitions. [M-EC], [M-BU] |
| S3-036..S3-040 | Exploration/visibility, finite deposits/surveying, territory/pioneers, actual entity rendering and conservation scenarios. | Player-view isolation, depletion and border-change fixtures; rendered cargo agrees with state. [C] |
| S3-041 | Timber, tree growth/forestry, sawmill and finite stone. | Worker trips and observable depletion/recovery, not a global-stock increment. [M-BU] |
| S3-042 | Fish, fields/grain, water, milling/baking, livestock and meat. | Complete evidenced input/output and work-cycle catalogs per applicable faction. [C] |
| S3-043 | Deposits, mining, food preferences and exhaustion. | Delivered food changes actual mine work; per-resource/faction fixtures. [C] |
| S3-044 | Iron, gold and gem processing, including wealth/strength inputs. | Physical processing and independently evidenced wealth calculation. [C] |
| S3-045 | Complete tool and infantry-weapon production with priorities/urgent orders. | Recipe/tool catalog, weighted queues and shortage behavior. [C] |
| S3-046..S3-050 | Working areas, production/distribution controls, civilian specialists, truthful statistics and sustainable Roman economy. | Controls change real jobs; shortages can be induced and recovered from without grants. [M-BU], [M-ME], [C] |
| S3-051..S3-055 | Recruitment; individual selection/orders; combat/projectiles; garrisons/capture; healing/theft and other specialist interactions. | Real units/cargo, ownership checks, interrupted commands, deterministic damage and capture consequences. [M-MI], [C] |
| S3-056..S3-058 | Roman special production and religion; offerings/manna/priests; rank unlocks and complete Roman intervention catalog. | Effects and recruitment cutoffs independently observed; no retroactive promotion. [M-MI], [C] |
| S3-059 | Egyptian buildings, production, religion, troops and interventions. | Separate faction definitions and fixtures, not Roman values with different sprites. [C] |
| S3-060 | Asian buildings, rice/sulfur/gunpowder, religion, troops and interventions. | Complete faction chain and effect inventory. [C] |
| S3-061 | Amazon buildings, honey/mead/alchemy, special resources, religion, troops and interventions. | Expansion-specific identifiers, rules and observations. [C] |
| S3-062..S3-064 | Faction siege/ammunition, terrain/balance differences and combined warfare/religion qualification. | Target/terrain restrictions, actual resource costs, every faction and intervention covered. [C] |
| S3-065..S3-069 | Shipbuilding/water routes; ferries and colonies; donkey/marketplace routes; docks/cargo; diplomacy and recovery. | Accounted-for people and goods across embarkation, transit, unloading, capture and loss; human trade distinguished from colony supply. [M-TR], [C] |
| S3-070..S3-074 | Economic/recovery, military/religious and naval/colony AI; skirmish setup, difficulty and random maps. | Same legal commands and allowed information, declared difficulty policy and reproducible seeds. This is E, not proof of original AI algorithms. [P] |
| S3-075 | Safe declarative mission/objective runtime. | Trigger/condition/action vocabulary grounded in imported records, bounded execution and mid-event restore. [C] |
| S3-076..S3-080 | Tutorials; base Roman/Egyptian/Asian campaigns; Mission CD content; both Amazon paths. | Per-mission identity, start, objectives, events, failure, media, victory and progression ledger. Counts and IDs remain provisional below. [M-PR], [C] |
| S3-081 | Terrain/resource/entity/player/objective editing, undo and validated import/export. | Original-compatible supported records distinguished from remake extensions. [C] |
| S3-082 | Exhaustive campaign availability, unlocks/branches, briefings, cinematics, localization and endings. | No unmatched required original mission or media record. [C] |
| S3-083..S3-085 | Original control-center structure, truthful inspection panels, minimap, alerts, camera and keyboard commands. | Command/state correspondence, visibility-aware overview and contextual panel fixtures. [M-ME], [C] |
| S3-086..S3-089 | Terrain/entity/animation fidelity; music/effects/voice; localization, accessibility/touch; matched-scene review. | Camera/state-matched original and browser/native captures with declared visual/audio tolerances. [C] |
| S3-090..S3-092 | Complete versioned saves, lifecycle-safe checkpoints, deterministic replay and divergence diagnostics. | Mid-job restoration, failed-write recovery and first divergent tick across supported runtimes. [P] |
| S3-093..S3-096 | New session/content protocol, authoritative server, visibility-filtered updates, reconnect, observers/teams/chat and cross-platform play. | Incompatible clients rejected; hidden state absent from payloads; reconnect resumes authoritative state. Legacy protocol interoperability is excluded. [P] |
| S3-097..S3-101 | Encrypted credentials, Apple resources, iOS/Play delivery, desktop signing/installers and updates. | Protected credential handling and signed installation/upload/processing evidence; account prerequisites reported precisely. [P] |
| S3-102 | Licensed store media, attribution, localized descriptions/privacy declarations and free pricing. | Every claim matches actual content/capabilities and allowed channel. [P] |
| S3-103 | Repeatable release orchestration and receipts. | Source/version/lock identity, signed checksums, retries and accurate store state. [P] |
| S3-104..S3-107 | Performance budgets, platform/campaign matrix, untrusted-input/security checks and finished-release qualification. | Recorded hardware, retained failures and installation/update/store-availability evidence; every mandatory fidelity gate below satisfied. [P] |

Supported targets are **E:** browser, macOS, Windows, Linux, iOS and Android. Browser/native/server share simulation semantics; platform support also requires actual host presentation and lifecycle evidence. Minimum OS/browser versions, device tiers, locales, multiplayer limits and performance numbers are U until qualified. HomeOS reuse has its own evidence gate and does not block these six targets. [P]

The campaign ledger currently contains **72 mission planning slots plus one tutorial slot**, derived provisionally from a secondary index. These are not original IDs, verified counts or a complete tutorial inventory. Retain the [existing ledger][CA] as a reconciliation checklist only. S3-006/007/076..082 must replace/expand it from original data and observations, including optional/branch missions, region/language differences, objective scripts and media. No original map identifier or license is established by a planning-slot name.

## Unverified numeric and content values

Here U means no admitted original-build fixture, even where a manual gives a candidate. The following matrix applies independently to B, M and A; G must select an evidenced applicable value, not average the three.

| Category | B | M | A | Required resolution |
|---|---|---|---|---|
| Executable versions, patch ordering and changed rules | U | U | U | S3-001: original build/patch identities and delta records. |
| Complete campaign/map/tutorial IDs, counts, starts and objectives | U | U | U | S3-002/006/007/075..082: original manifests and per-mission evidence. |
| Goods/profession/building/unit/ship/intervention catalog completeness | U | U | U | S3-004..007: identifiers, applicability and unsupported records. |
| Construction costs, footprint/entrance geometry, levelling/work time, demolition refunds | U | U | U | S3-026/032/033/063: decoded tables plus repeatable original observations. |
| Carrier capacity, doorstep/storage limits, priorities and workforce allocations | U | U | U | S3-029..035/047: saturation and competing-request fixtures. |
| Production recipes/yields/times, resource quantities, regrowth, work radii, preferred-food effects | U | U | U | S3-037/041..047/063: isolated chain fixtures. |
| Movement/path/occupancy costs, water/coast validity, loading limits and route priorities | U | U | U | S3-027/028/065..069: routes, interrupted trips and transfer accounting. |
| Recruitment, rank/manna costs, damage/health/range, wealth formulas, siege and intervention parameters | U | U | U | S3-051..064: isolated and combined faction-specific fixtures. |
| Territory/vision radii, capture consequences and specialist detection/healing/theft rules | U | U | U | S3-036/038/054/055: controlled visibility and ownership transitions. |
| Original clock rate, speed settings, command timing, AI bonuses/policies and economic victory thresholds | U | U | U | S3-002/049/070..075/092: timed observations, explicit E departures for same-rules AI. |
| Frame/action/direction mappings, anchor/projection measurements, audio timing and localized content | U | U | U | S3-004/005/083..089: matched captures and original identifiers. |

For example, the manual gives doorstep/storage capacities and a faction building-material table. These are **M candidates**, not currently admitted universal runtime constants. Transcribe with a pinned table location, preserve exceptional rows, and test applicability to each original build before using them as the baseline. [Economy][M-EC], [building table][M-BU]

No fallback to JSettlers constants, prototype constants or plausible-looking values may convert U to O. A temporary experiment, if needed, must remain explicitly non-fidelity evidence and cannot qualify a release.

## Contradictions and deltas to observe first

These are questions for S3-002 fixtures, not resolved original rules. Each fixture must isolate one cause, record profile/build/content hashes, and retain initial state, ordered input, elapsed original-game time, result and captures. Repeat it independently before admitting a rule.

| Discriminating case | Evidence or tension | Required observation |
|---|---|---|
| Recruits before and after a promotion | M-04 makes a recruitment-time distinction. [M-MI] | Compare existing versus newly recruited units; test interrupted promotion and a save across completion. |
| Competing site and storage requests with scarce carriers | M-01 documents priority but not every scheduling tie. [M-EC] | Trace one physical good to one destination, then block the route, cancel a site and fill storage. |
| Pioneer expansion versus military capture | The occupations page describes pioneer expansion; military behavior also affects borders. [M-JO], [M-MI] | Separate unowned land, enemy territory, tower capture and isolated holdings. Avoid interpreting a prose “only” as the whole ownership algorithm. |
| AI colony supply versus inter-player trade | M-05 excludes computer trading. [M-TR] | Confirm human-to-human delivery and own-colony shipping separately. Same-rules naval AI must not create an undocumented AI trade agreement. |
| Expansion changes versus launch behavior | The revision page groups changes without a complete build-by-build chronology. [M-CH] | Run identical fixtures on identified B/M/A installations; record changed result or explicitly evidenced equivalence. |
| Reference remake versus original | The pinned reference declares different controls. [R] | Use it to locate candidate data/algorithms; compare outcome and controls against the original before reuse. |
| Prototype success versus fidelity | The [existing audit][A] identifies global stock, decorative workers, numeric armies and a custom campaign. | Keep Riverlands as regression evidence; demonstrate actual cargo/units, original missions and matched scenes independently. |
| Manual prose versus actual capture/destruction behavior | Recruitment and military dependencies are documented, but complete state transitions are not admitted. [M-MI] | Record goods, workers, housing, idle settlers and troops around each capture/demolition; retain any discrepancy without silently choosing a convenient rule. |

## Exact finish gates

These gates are **E acceptance requirements**, not claims of current completion. [P], [C]

1. **Evidence:** each claimed original rule has an applicable profile, pinned source and admitted observation where behavior/timing is required. No unresolved mandatory U or contradiction is hidden behind a default. Exact revision differences are recorded; documentary statements and observations remain distinguishable.
2. **Content and rights:** every required original mission, map, entity/media/localization record is reconciled to an original ID/hash. Every distributed file has recorded rights for that release channel. A source-code license or downloadable demo is insufficient. Required content without rights blocks the bundled release.
3. **Simulation:** commands reproduce identical tick checksums on browser, Bun and every retained native runtime. Conservation includes explicit production/consumption/destruction; blocked routes, full outputs, absent tools and exhausted deposits change actual work. Same-rules AI uses allowed commands/information and recovers legally or loses.
4. **Campaigns:** each original mission passes its own start/objective/trigger/failure/save/restore/victory/progression ledger. Briefings, endings, branches and localized media are checked. Generic victory, a loaded map or a provisional slot does not satisfy this gate.
5. **Presentation and controls:** matched original scenes pass declared, retained visual/audio tolerances on browser and native adapters. Controls and panels reflect real state. Touch/accessibility adaptations are explicit E additions and do not silently change desktop defaults or simulation rules.
6. **Native proof:** actual frames, animation, input and stx HUD interaction are demonstrated without WebView gameplay on each required host. Resize/scale/suspend/device-error/disposal and repeated sessions preserve resources. Compilation, a blank window, CPU-only pixels or a VM bridge test cannot substitute for native presentation evidence.
7. **Persistence and multiplayer:** mid-job saves restore completely; interrupted writes retain the previous valid state; prototype incompatibilities are explained. Authenticated authoritative matches enforce versions, ownership and ordering, filter concealed state before transport, and recover from reconnect/backgrounding. Cross-platform scenarios retain receipts.
8. **Qualification and delivery:** S3-104 budgets are measured on recorded hardware, including mobile behavior. The full platform/campaign matrix and untrusted-input checks pass. Signed artifacts install and upgrade; upload, processing, review/submission and public availability are separately verified. The release receipt binds source, published dependencies, lockfile, tests, artifacts and store outcomes.

Original network byte compatibility, JSettlers protocol compatibility, HomeOS kernel bring-up and recreating obsolete online infrastructure are outside the approved delivery contract. New multiplayer and modern release infrastructure are E decisions. [P]

## S3-001 acceptance status and next evidence

| Criterion | Status in this draft | Remaining work |
|---|---|---|
| Identify edition and revision differences | Partial | Distinguish original executable revisions and expand the edition delta matrix using identified original installations. The mirror revision is not enough. |
| Enumerate supported systems and content packs | Scope enumerated | Reconcile complete original per-file/per-mission inventories; supported scope is not proven content completeness. |
| Mark unsupported/unverified claims | Explicit M/O/E/U classes and unknown matrices | Keep them current when evidence arrives; do not inherit unknowns as production constants. |
| Trace claimed rules to evidence and compare profiles | Documentary anchors pinned; all eight manual hashes rechecked | No original runtime comparisons have been executed. Obtain and retain S3-002 original observations. |
| Retain reviewable evidence | This contract plus pinned source/hash references | Commit/review this draft with the owning issue and record remaining gaps. No package release or native capability claim is created by this document. |

S3-001 should remain open until its edition/revision comparison is defensible. Unknown numeric values may remain assigned to S3-002/007, provided the specification names them and prevents unsupported fidelity claims. This draft does not claim that any original build, mission manifest or redistribution grant has been verified.

## Source pins

The following are preserved primary-document pages at one immutable archive commit. Section names identify where to inspect the documentary claims above. [H] contains all eight raw-file SHA-256 values, independently matched on the review date. Links to the reference remake are primary evidence for that remake only.

| Key | Pinned source and relevant sections |
|---|---|
| M-CH | [Changes][M-CH]: revision notice; Amazons, trade and miscellaneous links. |
| M-PR | [Preparing for the Game][M-PR]: start menus, tutorial, base campaigns, Mission CD, Amazon/Three Gods campaigns, editor and game modes. |
| M-EC | [Economic basics][M-EC]: transportation, storage, builders. |
| M-BU | [Buildings][M-BU]: building materials, work areas, finite resources and faction table. |
| M-JO | [Occupations][M-JO]: carriers, diggers/builders, pioneers and specialist occupations. |
| M-ME | [Menus][M-ME]: overview, control center, information and player controls. |
| M-TR | [Trade][M-TR]: human trade, own-colony transport, land and sea. |
| M-MI | [Military][M-MI]: recruitment, promotions, unit commands and ownership interactions. |

[P]: ../roadmap/specification.md
[C]: ../roadmap/catalog.ts
[CA]: ../roadmap/campaigns.ts
[H]: ../roadmap/evidence.md
[A]: ../fidelity-audit.md
[R]: https://github.com/paulwedeck/settlers-remake/blob/6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0/README.md
[M-CH]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/changes/changes.htm
[M-PR]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/in_prep/prepare.htm
[M-EC]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/ec_basic/basics.htm
[M-BU]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/ec_build/building.htm
[M-JO]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/ec_jobs/jops.htm
[M-ME]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/in_menu/menu.htm
[M-TR]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/ec_trade/trade.htm
[M-MI]: https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/military/military.htm
