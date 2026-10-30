import type { SceneItem } from '../../resources/game/scene'
import { loadOriginalAssets } from '../../resources/game/assets'
import { createSession, describeMap, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'
import { scene } from '../../resources/game/scene'

interface OriginalImage { width: number, height: number, offsetX: number, offsetY: number, data: number[] }
interface Pose { sprite: string, frame: number, body: OriginalImage, shadow: OriginalImage }
const result = document.querySelector('#result')!
try {
  const expected = await fetch('/expected.json').then(response => response.json()) as { poses: Pose[], trees: Record<string, OriginalImage>, masks: Record<string, { body: OriginalImage, shadow: OriginalImage | null }[]> }
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!, renderer = createRenderer(canvas), atlas = await loadOriginalAssets()
  renderer.setAssets(atlas)
  const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  const actorSurface = document.createElement('canvas'), actorContext = actorSurface.getContext('2d')!, actorImages = new Map<string, HTMLCanvasElement>()
  actorSurface.width = canvas.width; actorSurface.height = canvas.height
  const frontActorSurface = document.createElement('canvas'), frontActorContext = frontActorSurface.getContext('2d')!
  frontActorSurface.width = canvas.width; frontActorSurface.height = canvas.height
  const actorImage = (key: string, original: OriginalImage): HTMLCanvasElement => {
    const cached = actorImages.get(key)
    if (cached) return cached
    const surface = document.createElement('canvas'); surface.width = original.width; surface.height = original.height
    surface.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(original.data), original.width, original.height), 0, 0)
    actorImages.set(key, surface); return surface
  }
  const options = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null }
  const directions = [
    { name: 'north-east', dx: 0, dy: -1 }, { name: 'east', dx: 1, dy: 0 }, { name: 'south-east', dx: 1, dy: 1 },
    { name: 'south-west', dx: 0, dy: 1 }, { name: 'west', dx: -1, dy: 0 }, { name: 'north-west', dx: -1, dy: -1 },
  ]
  const sample = (image: OriginalImage, x: number, y: number): number[] | null => {
    x -= image.offsetX; y -= image.offsetY
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
    const index = (y * image.width + x) * 4
    return image.data[index + 3] ? image.data.slice(index, index + 4) : null
  }
  // Compose independently decoded masks through native Canvas source-over,
  // so each platform's byte quantization remains an exact comparison.
  const expectedSurface = document.createElement('canvas'), maskSurface = document.createElement('canvas')
  expectedSurface.width = expectedSurface.height = maskSurface.width = maskSurface.height = 1
  const expectedContext = expectedSurface.getContext('2d')!, maskContext = maskSurface.getContext('2d')!, blends = new Map<string, number[]>()
  const blend = (background: number[], alpha: number): number[] => {
    const key = `${background}:${alpha}`, cached = blends.get(key)
    if (cached) return cached
    expectedContext.putImageData(new ImageData(new Uint8ClampedArray([...background, 255]), 1, 1), 0, 0)
    maskContext.putImageData(new ImageData(new Uint8ClampedArray([0, 0, 0, alpha]), 1, 1), 0, 0)
    expectedContext.drawImage(maskSurface, 0, 0)
    const value = [...expectedContext.getImageData(0, 0, 1, 1).data].slice(0, 3)
    blends.set(key, value); return value
  }
  // Non-actor bounds exclude unrelated fixtures. Actor occlusion uses exact
  // independently decoded masks below, rather than an oversized rectangle.
  const bounds = (item: SceneItem) => {
    const bodies = atlas.frames.get(item.sprite) ?? []
    const frames = item.kind === 'shadow'
      ? bodies.flatMap(body => body.shadow ? atlas.frames.get(body.shadow)?.filter(frame => frame.frame === body.frame) ?? [] : [])
      : bodies
    if (!frames.length) return null
    const at = renderer.screen(item.view)
    return { left: at.x + Math.min(...frames.map(frame => frame.offsetX)), right: at.x + Math.max(...frames.map(frame => frame.offsetX + frame.width)), top: at.y + Math.min(item.kind === 'settler' ? -41 : 0, ...frames.map(frame => frame.offsetY)), bottom: at.y + Math.max(...frames.map(frame => frame.offsetY + frame.height)) }
  }
  let pixels = 0, bodyPixels = 0, shadowPixels = 0, occlusionPixels = 0, cases = 0, warmChecks = 0
  const visited = new Set<string>(), shadowPoses = new Set<string>()
  const check = (direction: typeof directions[number], heights: readonly [number, number], tree = false): void => {
    const map = describeMap(rules, { width: 96, height: 96, base: 'grass', features: tree ? [{ kind: 'object', id: 'tree', x: 42, y: 61, radius: 0 }] : [] })
    map.elevation[54 * 96 + 40] = heights[0]
    map.elevation[(54 + direction.dy * 8) * 96 + 40 + direction.dx * 8] = heights[1]
    const players = [
      { name: 'Rome', civilization: 'roman' as const, start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [] as { profession: string, x: number, y: number }[] } },
      { name: 'Other', civilization: 'roman' as const, start: { x: 40, y: 40 }, scenario: { buildings: [], settlers: [] as { profession: string, x: number, y: number }[] } },
    ]
    // A separately authored, empty-army world supplies the same real terrain
    // behind isolated pixels. No state or visibility in the live shot is patched.
    const baseline = createSession({ rules, map: structuredClone(map), seed: 1, players })
    const session = createSession({ rules, map, seed: 1, players: players.map((player, index) => ({ ...player, scenario: { ...player.scenario, settlers: index === 0 ? [{ profession: 'bowman', x: 40, y: 54 }] : [{ profession: 'pikeman', x: 40 + direction.dx * 8, y: 54 + direction.dy * 8 }] } })) })
    try {
      if (Object.keys(session.skipped).length || Object.keys(baseline.skipped).length) throw new Error('Arrow fixture could not place its authored world')
      const bowman = [...session.state.settlers.values()].find(person => person.owner === 1 && person.soldier)!
      if (session.enqueue({ tick: 0, player: 1, seq: 0, type: 'move-soldiers', soldiers: [bowman.id], x: 40, y: 54 })) throw new Error('Bowman hold order was rejected')
      session.advance(1)
      const projectile = session.state.projectiles?.[0]
      if (!projectile || projectile.arrives - projectile.fired !== 20) throw new Error('Real bowman did not fire its ordinary shot')
      for (const [tick, frame] of tree ? [[10, 1]] as const : [[4, 0], [10, 1], [16, 2]] as const) {
        session.advance(projectile.fired + tick - session.state.tick)
        const checksum = session.checksum(), baseChecksum = baseline.checksum(), items = scene(session, { player: 1 })
        const body = items.find(item => item.kind === 'arrow' && item.entity === projectile.id)!, pose = expected.poses.find(pose => pose.sprite === `arrow:${direction.name}` && pose.frame === frame)
        if (!pose || body?.sprite !== pose.sprite || body.frame !== frame) throw new Error('Directional arrow or flight frame differs from the source contract')
        const share = tick / 20, lift = 20 + 20 * share * (1 - share)
        renderer.home({ x: 40 + direction.dx * 8 * share, y: 54 + direction.dy * 8 * share }, heights[0] + (heights[1] - heights[0]) * share + lift / 2)
        renderer.draw(baseline, options)
        const background = context.getImageData(0, 0, canvas.width, canvas.height)
        renderer.draw(session, options)
        const actual = context.getImageData(0, 0, canvas.width, canvas.height), projected = renderer.screen(body.view)
        if (Math.abs(projected.x - 200) > 1e-7 || Math.abs(projected.y - 140) > 1e-7) throw new Error('Camera did not center the actual anchored flight point')
        // Read the centered device-pixel cell. A floating remainder such as
        // 239.99999999999994 must not floor the oracle into the preceding row.
        const origin = { x: Math.round(projected.x), y: Math.round(projected.y) }
        const foreground = tree ? items.find(item => item.kind === 'tree') : undefined
        const treeImage = foreground ? expected.trees[foreground.sprite] : undefined, treeOrigin = foreground ? renderer.screen(foreground.view) : null
        actorContext.setTransform(1, 0, 0, 1, 0, 0); actorContext.clearRect(0, 0, actorSurface.width, actorSurface.height)
        actorContext.setTransform(ratio, 0, 0, ratio, 0, 0); actorContext.imageSmoothingEnabled = false
        frontActorContext.setTransform(1, 0, 0, 1, 0, 0); frontActorContext.clearRect(0, 0, frontActorSurface.width, frontActorSurface.height)
        frontActorContext.setTransform(ratio, 0, 0, ratio, 0, 0); frontActorContext.imageSmoothingEnabled = false
        for (const item of items.filter(item => !item.sprite.startsWith('arrow:') && (item.kind === 'settler' || item.kind === 'shadow'))) {
          const originals = expected.masks[item.sprite]
          if (!originals) throw new Error(`Independent actor mask missing: ${item.sprite}`)
          const per = originals.length / 6, index = item.progress === undefined ? item.frame : item.frame * per + Math.min(per - 1, Math.floor(item.progress * per))
          const original = item.kind === 'shadow' ? originals[index]!.shadow : originals[index]!.body
          if (!original) continue
          const at = renderer.screen(item.view), image = actorImage(`${item.sprite}:${index}:${item.kind}`, original)
          const contexts = [actorContext, ...(items.indexOf(item) > items.indexOf(body) ? [frontActorContext] : [])]
          for (const target of contexts) {
            target.drawImage(image, at.x + original.offsetX, at.y + original.offsetY)
            if (item.kind === 'settler' && item.health !== undefined) target.fillRect(at.x - 6, at.y - 40, 12, 4)
            if (item.kind === 'settler' && item.owner !== 1) target.fillRect(at.x - 3, at.y - 35, 6, 4)
          }
        }
        const actorPixels = actorContext.getImageData(0, 0, actorSurface.width, actorSurface.height)
        const frontActorPixels = frontActorContext.getImageData(0, 0, frontActorSurface.width, frontActorSurface.height)
        const masks = items.filter(item => !item.sprite.startsWith('arrow:') && item !== foreground && item.kind !== 'settler' && item.kind !== 'shadow').map(item => ({ order: items.indexOf(item), rect: bounds(item) })).filter(value => value.rect !== null)
        const bodyOrder = items.indexOf(body), shadowOrder = items.findIndex(item => item.kind === 'shadow' && item.sprite === body.sprite && item.entity === projectile.id)
        const left = Math.min(pose.body.offsetX, pose.shadow.offsetX) - 2, top = Math.min(pose.body.offsetY, pose.shadow.offsetY) - 2
        const right = Math.max(pose.body.offsetX + pose.body.width, pose.shadow.offsetX + pose.shadow.width) + 2, bottom = Math.max(pose.body.offsetY + pose.body.height, pose.shadow.offsetY + pose.shadow.height) + 2
        let visibleBody = 0, visibleShadow = 0
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const px = origin.x + x, py = origin.y + y
          const color = sample(pose.body, x, y), shadow = sample(pose.shadow, x, y)
          const cover = treeImage && treeOrigin ? sample(treeImage, Math.round(px - treeOrigin.x), Math.round(py - treeOrigin.y)) : null
          // The baseline already contains these map objects. Only a later
          // object can occlude an opaque arrow or its translucent shadow.
          if (!cover && (color || shadow) && masks.some(({ order, rect }) => order > (color ? bodyOrder : shadowOrder) && rect && px >= Math.floor(rect.left) - 1 && px <= Math.ceil(rect.right) + 1 && py >= Math.floor(rect.top) - 1 && py <= Math.ceil(rect.bottom) + 1)) continue
          for (let dy = 0; dy < ratio; dy++) for (let dx = 0; dx < ratio; dx++) {
            const index = ((Math.floor(py * ratio) + dy) * actual.width + Math.floor(px * ratio) + dx) * 4
            // Opaque arrow pixels overwrite actors behind them. Translucent
            // shadows and blank pixels need the empty-army ground reference.
            if (!cover && (color ? frontActorPixels.data[index + 3] : actorPixels.data[index + 3])) continue
            let wanted = [...background.data.subarray(index, index + 3)]
            if (cover) { wanted = cover.slice(0, 3); if (color) occlusionPixels++ }
            else if (color) { wanted = color.slice(0, 3); visibleBody++; bodyPixels++ }
            else if (shadow) { wanted = blend(wanted, shadow[3]!); visibleShadow++; shadowPixels++ }
            const got = [...actual.data.subarray(index, index + 3)]
            if (got.join() !== wanted.join()) {
              const nearby = items.map(item => ({ kind: item.kind, sprite: item.sprite, frame: item.frame, progress: item.progress, depth: item.depth, rect: bounds(item) })).filter(item => item.rect && px >= item.rect.left - 1 && px <= item.rect.right + 1 && py >= item.rect.top - 1 && py <= item.rect.bottom + 1)
              throw new Error(`Arrow ${pose.sprite}:${frame}/${heights}/${tree} at ${x},${y}: ${got} instead of ${wanted}; ${JSON.stringify({ background: [...background.data.subarray(index, index + 3)], color, shadow, actorAlpha: actorPixels.data[index + 3], nearby })}`)
            }
            pixels++
          }
        }
        if (!tree && visibleBody < 4 * ratio ** 2) throw new Error(`The source pose was not independently visible: ${pose.sprite}:${frame}/${heights}/${visibleBody}`)
        if (visibleShadow) shadowPoses.add(`${pose.sprite}:${frame}`)
        const restored = restore(JSON.parse(JSON.stringify(save(session))), rules)
        try {
          const before = canvas.toDataURL(); renderer.draw(restored, options)
          if (canvas.toDataURL() !== before || restored.checksum() !== checksum) throw new Error('Saved projectile did not retain its exact presentation')
          renderer.draw(restored, options)
          if (canvas.toDataURL() !== before || renderer.terrainCacheMemory().rebuiltChunks !== 0) throw new Error('Paused projectile or warm terrain changed without a tick')
          warmChecks++
        }
        finally { restored.dispose() }
        if (session.checksum() !== checksum || baseline.checksum() !== baseChecksum) throw new Error('Arrow rendering mutated a simulation')
        visited.add(`${pose.sprite}:${frame}:${heights}`); cases++
      }
    }
    finally { session.dispose(); baseline.dispose() }
  }
  for (const direction of directions) for (const heights of [[0, 0], [13, 2]] as const) check(direction, heights)
  check(directions[3]!, [0, 0], true)
  if (cases !== 37 || visited.size !== 36 || !occlusionPixels || shadowPoses.size !== 18) throw new Error(`Original arrow direction, height, shadow or occlusion coverage is incomplete: ${JSON.stringify({ cases, visited: visited.size, occlusionPixels, shadowPoses: [...shadowPoses], bodyPixels, shadowPixels })}`)
  renderer.setAssets(atlas)
  if (renderer.terrainCacheMemory().bytes || renderer.terrainFrameMemory().bytes || renderer.tintedFrameCount()) throw new Error('Asset replacement retained renderer surfaces')
  renderer.dispose()
  for (const image of actorImages.values()) image.width = image.height = 0
  actorSurface.width = actorSurface.height = frontActorSurface.width = frontActorSurface.height = expectedSurface.width = expectedSurface.height = maskSurface.width = maskSurface.height = 0
  if (renderer.terrainMaterialMemory().bytes || renderer.terrainCacheMemory().bytes || renderer.terrainFrameMemory().bytes || renderer.tintedFrameCount()) throw new Error('Arrow fixture disposal retained renderer surfaces')
  result.textContent = JSON.stringify({ ok: true, deviceScale: devicePixelRatio, cases, directions: 6, frames: 3, heightPairs: [[0, 0], [13, 2]], pixels, bodyPixels, shadowPixels, occlusionPixels, shadowPoses: shadowPoses.size, warmChecks, saveRestore: true, checksumUnchanged: true, replacementAndDisposal: true, southeast: 'original-sequence-105-artwork; pinned-drawer-104-duplication-recorded' })
}
catch (error) { result.textContent = JSON.stringify({ ok: false, error: String(error) }); throw error }
