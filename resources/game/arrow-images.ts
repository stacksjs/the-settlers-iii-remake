import type { Point } from './engine/geometry'

// The original demo's southeast silhouettes are sequence 105. The pinned
// drawer repeats 104 for EAST and SOUTH_EAST; choosing 105 follows the actual
// directional artwork, not an observation of the original Gold executable.
export const arrowImages = [
  { key: 'arrow:north-east', file: 1, sequence: 103, frames: 3 },
  { key: 'arrow:east', file: 1, sequence: 104, frames: 3 },
  { key: 'arrow:south-east', file: 1, sequence: 105, frames: 3 },
  { key: 'arrow:south-west', file: 1, sequence: 100, frames: 3 },
  { key: 'arrow:west', file: 1, sequence: 101, frames: 3 },
  { key: 'arrow:north-west', file: 1, sequence: 102, frames: 3 },
] as const

export const arrowReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/MapObjectDrawer.java',
  'jsettlers.common/src/main/java/jsettlers/common/movable/EDirection.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/objects/arrow/ArrowObject.java',
] as const

const TAN_22_5 = Math.tan(Math.PI / 8), TAN_67_5 = Math.tan(3 * Math.PI / 8)

/** The reference's EDirection.getApproxDirection, including float division. */
export function arrowImage(from: Point, to: Point, progress: number) {
  const dx = to.x - from.x, dy = to.y - from.y, incline = Math.fround(dy / dx)
  const direction = dx === 0 ? dy < 0 ? 0 : 3
    : dx > 0 ? incline < -1 ? 0 : incline < TAN_22_5 ? 1 : incline < TAN_67_5 ? 2 : 3
      : incline < -1 ? 3 : incline < TAN_22_5 ? 4 : incline < TAN_67_5 ? 5 : 0
  return { sprite: arrowImages[direction]!.key, frame: Math.max(0, Math.min(2, Math.round(progress * 2))) }
}

/** Display-space launch height and arc, independent of simulation timing. */
export const arrowLift = (progress: number): number => 20 + 20 * progress * (1 - progress)
