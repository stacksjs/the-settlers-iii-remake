# Native foundation execution audit

Recorded 2026-10-21 for S3-008. This audit separates executed behavior, verified source defects, and planned capabilities. It is not a claim of native game parity.

## Inspected sources

| Owner | Baseline revision | Relevant evidence |
|---|---|---|
| Game | `884406e97f912d18a50a33734b535a27dd25531d` | Independent TypeScript prototype simulation, Canvas 2D scene, stx UI, Craft browser storage/audio/lifecycle |
| Craft | `cfde9ae33285d0697182fc794f799e108c11db32` | Native renderer/GPU code, retained Zig pixel tests, maintained mobile hosts, persistent JavaScript runtime |
| stx | `3b9a5bf8249107f7c833615fa12803cd0bb0344d` | Shared signals and native host contract, documented UIKit/JSC simulator evidence, animation-frame composable |
| Stacks | `c8e9b2755edeead39ecf6aa540014a7642ff7149` | Desktop/mobile build actions, encrypted environment CLI, Apple packaging and App Store Connect modules |
| HomeOS | `151269666bc09aa15a271f1c1f4603f681132e65` | Generated kernel/boot evidence, compositor algorithms, unproven Craft GPU bridge |

Source fixes are integrated with the latest upstream revisions before release. Their final SHAs, package versions, checks, and limitations belong in the execution receipt.

## Capability inventory

| Capability | Evidence and verdict | Next gate |
|---|---|---|
| Craft CPU drawing | Retained renderer tests inspect real clear, rectangle, circle, and line pixels. This is a usable OS-independent starting point. | Bounded atlas composition, text, terrain triangles, and frame contract |
| Craft GPU draw and shaders | Baseline draw/indexed/compute paths count or discard work. Shader helpers mark nonempty source successful without real compilation. These are false-success defects, not native rendering evidence. | Explicit unsupported errors now; actual backend execution and native screenshots later |
| Native scene presentation | Neither primitive translation nor offscreen pixel tests proves window/swapchain presentation. | Metal Apple surfaces and Vulkan Windows/Linux/Android surfaces, device loss, scale, teardown |
| Native stx controls | Maintained UIKit/JSC slice has real native control/input evidence and shares the normal signals/compiler contract. Reference renderer files do not inherit that evidence automatically. | A maintained RenderSurface and complete original HUD on each host |
| Native clock/lifecycle | Baseline synthetic native document remains visible when Craft APP_STATE becomes background/inactive, so imported animation clocks continue running. | Source regression through compiled native screens, pause/resume and unmount |
| JavaScript hosting | Craft retains a first-party zig-js realm but the inspected public surface chiefly evaluates to strings. Existing native mobile engines must be preserved. | Typed callbacks/buffers, bounded lifetime, exceptions, GC, and repeated frames |
| Input | Craft/stx already maintain native control and bridge events. This does not prove game-surface capture, gestures, keyboard modifiers, or world picking. | Shared normalized surface-input tests and real device interaction |
| Persistence/audio/files | Current game proves Craft browser storage, basic audio, and browser lifecycle. Native APIs and host-dependent support exist but complete game checkpoints, concurrency, files, and interruptions need dedicated evidence. | S3-017/018 and actual native game acceptance |
| Stacks native builds | Existing actions resolve remote content, bundled assets, native screens, and API sites. Baseline logs omit the effective target. | Source reporting and action-level secret-redaction fixtures |
| Environment bootstrap | Baseline env key creation can inherit permissive filesystem modes; rotation already contains safer write behavior. | Retained 0600 bootstrap/update tests and stdin secret ingestion |
| HomeOS kernel | Generated status records real kernel/boot and framebuffer-console execution. It would be inaccurate to describe all HomeOS as merely parsed source. | Preserve those measured claims independently |
| HomeOS compositor/GPU | The audited compositor and Craft bridge lack demonstrated graphical execution. Shader helpers set compiled=true without compilation. | Executed portable vectors, ABI harness, and actual QEMU graphical/input proof |

## Source-reuse decision

Keep the standalone 2D core in Craft, initially based on its tested raster module. It must not import a kernel, window manager, or application. Add actual RGBA atlas compositing, clipping, bounds checks, and ownership rules there. A later C ABI may expose proven operations to HomeOS. HomeOS rectangle/alpha/damage algorithms are candidates for comparison, not implementations to trust without tests.

HomeOS consumes shared operations only after executing ABI size/alignment, buffer lifetime, error, and pixel vectors. Its compositor integration must produce actual graphical and input evidence. This work remains independent of the supported game release platforms.

## Source fixes and remaining scope

The first execution repairs false rendering success, adds bounded RGBA sprite composition and allocation-failure coverage in Craft, fixes native animation visibility in stx, and reports normalized native build targets in Stacks. The encrypted key bootstrap defect is also assigned to its owning Stacks module.

These changes do not complete text rendering, terrain triangles, GPU presentation, native game controls, typed game hosting, original logistics, or Gold campaigns. S3-009/010/019/020 remain open until all their individual acceptance criteria have actual evidence.

## Evidence retention

Use the source repositories' retained tests and immutable commit links. Record exact executed counts and failures in the execution receipt. A flaky or failed broad test is reported explicitly and investigated; it is never silently represented as a passing native gate. The game's passing prototype campaign remains useful regression evidence but proves none of the missing original systems.

## Execution addendum, 2026-10-24

The inventory above records the October 21 baseline. The [shared engine receipt](receipts/native-engine-cli-2026-10-24.json) adds execution evidence from the original published Craft 0.0.319 macOS binary. Its executable SHA-256 matches the retained upstream publication record. The maintained `scripts/native-engine-check.ts` bundles the public game engine once, queues a future command, advances five ticks, restores the serialized save and verifies the recorded replay. Bun and Craft produced checksum `c331a944`. A real browser executed the identical bundle through the Stacks CDP driver and produced the same result, without console errors or failed requests.

This is one shared simulation fixture executed without a WebView in Craft. It does not exercise persistent frame callbacks, native game rendering, normalized native game input, or native application lifecycle. It also does not establish original Gold Edition behavior. The engineering rules profile and its unverified values remain explicit.

The [checkpoint disposal receipt](receipts/checkpoint-disposal-2026-10-24.json) records a separate application coordinator correction: closing the game during any of four delayed storage phases prevents another request or a false success, even when the adapter completes after cancellation. All ten checkpoint tests passed. An already-issued commit can still complete in an adapter that ignores cancellation; the intact state remains recoverable, while the closed coordinator reports disposal. Native host storage and lifecycle acceptance remain outstanding under S3-017 and S3-091.

The later [atomic session receipt](receipts/checkpoint-atomic-sessions-2026-10-24.json) records 21 passing checkpoint tests and real competing browser contexts using Craft 0.0.330 atomic storage. This replaces the prototype two-slot save protocol with a single compare-and-set record, preserves legacy saves, and refuses stale-session writes until explicit reload. Native host disposal fixes and their original artifacts remain separate upstream acceptance work. No native game completion is claimed.
