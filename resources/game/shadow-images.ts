// MapObjectDrawer adds 20*z_per_y to fragment depth. The reference's
// Ortho(-1,1) projection and depth normalization map Z with factor -1/2.
export const SHADOW_ROW_OFFSET = 40

/** Original Gold body selector to shadow selector, before edition mapping. */
export function shadowSequence(file: number, sequence: number): number | null {
  if (file === 1) {
    // ShadowMapping1: missing shadows at original body indices 26 and 33.
    if (sequence === 26) return null
    if (sequence > 26) sequence--
    if (sequence === 32) return null
    if (sequence > 32) sequence--
    return sequence
  }
  if ([10, 11, 12, 13].includes(file)) return sequence
  throw new Error(`Original sprite shadow mapping is not implemented for DAT ${file}`)
}
export const shadowReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/AdvancedDatFileReader.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/translator/ShadowTranslator.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/shadowmap/ShadowMapping.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/shadowmap/IdentityShadowMapping.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/shadowmap/ShadowMapping1.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/ImageProvider.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/MapObjectDrawer.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/MapContent.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/MapDrawContext.java',
  'go.graphics.swing/src/main/java/go/graphics/swing/opengl/LWJGLDrawContext.java',
  'go.graphics.swing/src/main/glsl/go/graphics/swing/gl33/unified.frag',
] as const
