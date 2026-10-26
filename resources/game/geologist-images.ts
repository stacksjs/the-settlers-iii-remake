// Original Roman selectors and action order from the pinned remake.
export const geologistReferencePaths = [
  'jsettlers.graphics/src/main/resources/jsettlers/graphics/map/draw/settlerimages/movables.txt',
  'jsettlers.graphics/src/main/resources/jsettlers/graphics/map/draw/settlerimages/movables-ROMAN.txt',
  'jsettlers.logic/src/main/java/jsettlers/logic/movable/specialist/GeologistMovable.java',
] as const
export const geologistImages = [
  { key: 'geologist', file: 11, sequence: 37, frames: 72 },
  { key: 'geologist-survey-1', file: 11, sequence: 39, frames: 31 },
  { key: 'geologist-survey-2', file: 11, sequence: 38, frames: 16 },
] as const

/** Reference action order and 1.4:1.5 ratio, within the existing task duration. */
export function geologistSurveyImage(progress: number): { sprite: string, frame: number } {
  const fraction = Math.max(0, Math.min(1, progress)), split = 14 / 29
  const image = fraction < split ? geologistImages[1] : geologistImages[2]
  const local = fraction < split ? fraction / split : (fraction - split) / (1 - split)
  return { sprite: image.key, frame: Math.min(image.frames - 1, Math.floor(local * image.frames)) }
}
