# The Settlers III Remake

A browser settlement strategy game built with Stacks, stx and Craft, working
toward a faithful remake of The Settlers III Gold Edition.

The game runs on a deterministic simulation in which every settler, tool and good
is real. Carriers fetch each plank and stone from where it lies, diggers level
sites, builders build from delivered material, and a workplace opens only when a
settler has walked there with the right tool. Soldiers are recruited from
carriers with real weapons, garrison towers, fight and capture buildings. It does
not yet reproduce the original game's promotions, other civilizations, ships,
campaigns or measured timings. See the [fidelity audit](docs/fidelity-audit.md) for verified matches
and gaps.

The [Gold Edition roadmap](docs/roadmap/README.md) tracks the original game,
Mission CD and Amazons, true native rendering, multiplayer and automated store
delivery through 12 epics and 107 implementation issues. The
[master issue](https://github.com/stacksjs/the-settlers-iii-remake/issues/4)
links the work across the game and its owning framework repositories.

## Play locally

```sh
bun install
bun run assets:import
./buddy dev frontend
```

Open http://localhost:3000. A Roman settlement starts on a generated landscape:
a castle, 38 settlers and the goods they brought. Choose a building, then click
open ground inside your border; with the keyboard, choosing a building moves the
cursor to the nearest valid site and Enter places it. Hold Shift to keep placing.
Drag to pan, scroll to zoom. Space pauses, H centers on the castle, S saves and
Escape cancels.

Choose **New settlement**, enter an optional unsigned **Map seed**, and choose
**Computer rival** for a Roman skirmish. Seed `2` is a verified starting map.
The rival surveys, expands, builds an economy, makes weapons and attacks through
the same commands as the player. Capture every enemy castle and tower to win;
losing your last military building ends the match. The displayed seed and mission
outcome survive save/reload. Leave the seed empty for a random map.

## The settlement

- Sites are levelled by diggers and built by builders from materials carriers
  deliver one at a time. Construction deliveries come before storage.
- Workers need a tool: woodcutters an axe, stonecutters and miners a pick,
  sawyers a saw, farmers a scythe, fishermen a rod. A workplace without its tool
  says so instead of hiring a phantom worker.
- Woodcutters and stonecutters walk to the nearest tree or granite in their
  working area; foresters replant; farmers sow fields that ripen; fishermen
  empty their waters; miners dig finite deposits and work longer after their
  favourite meal.
- Eight goods at a doorstep stop production. Mark goods for storage and carriers
  take them to storage areas, six piles of eight.
- Residences add settlers one at a time. The carrier ratio keeps a share of the
  population as carriers. Pioneers push the border; geologists survey mountains.
- Tearing a building down puts its stored goods and half its construction
  material on the ground.

Settlements save on this device every 30 seconds and when the page is hidden.
Saves are versioned envelopes validated as untrusted input. A save made with
different rules is refused rather than reinterpreted, and the earlier Riverlands
prototype save is kept untouched under its own key.

## Implementation

`resources/game/engine` is a browser-independent simulation. It advances integer
ticks from ordered commands with seeded randomness, and offers a player view that
withholds what that player cannot see, versioned saves and replays that report the
first divergent tick. A goods ledger proves conservation: every good is always in a
pile or a carrier's hands. Rules are a versioned profile in which every value names
its evidence: manual candidates, reference-remake geometry, engineering decisions,
or unverified placeholders owned by a roadmap issue. The current profile cannot
qualify a release.

Building footprints, doors, pile positions and builder spots come from the pinned
reference remake's Roman definitions (`bun scripts/reference-geometry.ts`). The
Canvas 2D renderer draws the lattice terrain with elevation shading, fog of war,
borders and the actual settlers, cargo, piles and construction stages from the
session. stx's `useAnimationFrame` supplies the clock and Craft's browser platform
supplies storage and lifecycle events.

Framework defects are repaired in their owning source repositories, released and
installed as packages. Do not patch node_modules, duplicate platform runtimes or
add application shims for framework failures.

## Verify

```sh
./buddy lint
bun run typecheck
./buddy test --unit
./buddy build views
./buddy serve --port 3450
# In another terminal:
bun run test:browser http://127.0.0.1:3450/
bun tests/browser/rival-battle.ts http://127.0.0.1:3450/
```

The engine suites check conservation every tick through construction,
demolition in every phase, production, depletion and restore, and cover routing,
determinism, saves, replays and player views. The browser check places a building
with the keyboard, changes speed, pauses, saves, reloads and verifies the restored
settlement, activates audio and checks background saves. The rival battle check
uses ten real minutes at the ordinary 4x speed, then verifies defeat persists
through save/reload. It qualifies one passive-player battle, not all seeds or
original Gold Edition balance.

## Original material

The asset pipeline follows [paulwedeck/settlers-remake](https://github.com/paulwedeck/settlers-remake),
which reads graphics and sounds from the original game or its Amazons demo.
`bun run assets:import` downloads the public demo from the Internet Archive,
verifies a pinned SHA-256, extracts its data without running the installer, and
converts the DAT files into an RGBA PNG atlas, JSON frame metadata and mono PCM
WAV audio. Anchors and animation directions are retained. Player-color torso
layers are composited in settlement gold.

The conversion uses JSettlers' pinned Roman building and demo-version mappings.
Its MIT notice is in `third-party/settlers-remake-LICENSE.txt`. The original game
art and sound have their own ownership; downloads and converted original assets
are local, ignored files. GitHub contains the importer and source provenance.
Run the importer after cloning the project to create the browser assets.

Every converted file now has exact byte, input-file and conversion-selector
provenance. The [content inventory and evidence](docs/content/provenance.md)
separate source-code licensing from original media. Redistribution permission
for the demo artwork and sounds remains unverified, with no authorized public
channels recorded. `bun run content:verify` checks local conversion provenance;
`bun run publication:check --channel web` and the corresponding native/release
channels block bundled publication until reviewed evidence covers it. Local
builds and regression tests establish behavior and do not grant distribution
rights.

The importer converts all 24 Roman buildings with their construction stages,
goods piles, carriers walking in six directions with each good, saplings, crops,
seven tree types, stone deposits and landscape textures, plus optional bird
ambience and construction sound through Craft's browser audio API. Enable sound
with the header control. `bun run maps:inventory` decodes the demo's original maps
without converting or publishing them.
