# The Settlers III Remake

A browser settlement strategy game built with Stacks, stx and Craft.

## Play locally

```sh
bun install
bun run assets:import
./buddy dev frontend
```

Open http://localhost:3000. The first campaign, The Riverlands, starts immediately.
Build within the golden border. Hover a building for its cost, choose it, then
click clear ground. Hold Shift to keep placing. Drag the map to pan, scroll to
zoom, or use arrow keys and Enter to choose tiles. Space pauses; H centers the
map; S saves; Escape cancels construction mode.

## The campaign

- Woodcutters harvest logs, sawmills make planks and stonecutters supply stone.
- Fisheries feed miners. Farms supply windmills and bakeries.
- Iron mines and coal mines supply smelters and weaponsmiths.
- Barracks turn swords and bread into soldiers. Residences add worker capacity.
- Guard towers extend the border and defend against growing raids.
- Claim the river crossing and march on the rival stronghold to win.

Campaigns save on this device every 30 seconds and when the page moves into the
background. Save and Load are also available in the header. A new island replaces
the saved campaign after confirmation. Wait for the Save confirmation before closing the browser. Browser termination
can interrupt a queued background checkpoint. No account or server is needed
for a match.

## Implementation

The STX page owns reactive UI state. The TypeScript simulation is independent of
the renderer and advances in fixed 50 ms steps. Canvas 2D draws the isometric
landscape, buildings and settlers. stx's `useAnimationFrame` supplies a clock that
suspends hidden tabs and caps frame stalls. Craft's browser platform supplies
scoped storage and native-compatible lifecycle events. Device storage failures
are reported without stopping the live game.

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
```

The retained simulation tests cover resource accounting, placement, construction,
territory, raids, win/loss, save validation and isometric picking. A full campaign
test reaches victory from the ordinary starting stock without resource grants.
The browser check uses the framework's Chrome driver to place a building with
the keyboard, change speed, pause, save, reload, and verify the saved settlement.
It also activates audio with the keyboard and checks background saves through
browser lifecycle events.

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

The importer includes six worker directions; current carriers render two of them.
The campaign uses the original buildings, seven tree types, stone deposits, landscape textures
and optional bird ambience and construction
sound through Craft's browser audio API. Enable sound with the header control.
