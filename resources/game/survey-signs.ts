// Original symbol selectors from MapObjectDrawer at the pinned remake revision.
// The twelve demo frames preserve original anchors and pixels. Frame choice is
// reference-remake evidence, not an original Gold runtime observation.
export const surveyReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/MapObjectDrawer.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/map/grid/objects/MapObjectsManager.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/objects/RessourceSignMapObject.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/constants/Constants.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/map/loading/original/OriginalMapFileContent.java',
] as const
export const surveySigns = [
  { good: 'coal', key: 'sign:coal', file: 1, sequence: 94, frames: 2 },
  { good: 'gems', key: 'sign:gems', file: 1, sequence: 95, frames: 2 },
  { good: 'goldore', key: 'sign:goldore', file: 1, sequence: 96, frames: 2 },
  { good: 'ironore', key: 'sign:ironore', file: 1, sequence: 97, frames: 2 },
  { good: 'sulfur', key: 'sign:sulfur', file: 1, sequence: 98, frames: 2 },
  { good: null, key: 'sign:empty', file: 1, sequence: 99, frames: 2 },
] as const

/**
 * Display the knowledge recorded by the geologist, never the hidden deposit.
 * The reference maps original 0..15 values to round(raw * 127/15), normalizes
 * signs by its maximum 50, then takes floor(progress * frames), clamped last.
 * Our engineering worlds keep raw counts, including generated values above 15;
 * the same display scale saturates there. This never converts mining reserves
 * or asserts that those quantities match the original executable.
 */
export function surveyMarker(good: string | undefined, amount: number): { sprite: string, frame: number } {
  const type = amount > 0 ? good : null
  const image = surveySigns.find(image => image.good === type)
  if (!image) throw new RangeError(`Unsupported surveyed resource: ${good}`)
  const progress = Math.round(amount * 127 / 15) / 50
  return { sprite: image.key, frame: image.good === null ? 0 : Math.min(image.frames - 1, Math.floor(progress * image.frames)) }
}
