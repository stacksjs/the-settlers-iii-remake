// MapObjectDrawer adds 20*z_per_y to fragment depth. The reference's
// Ortho(-1,1) projection and depth normalization map Z with factor -1/2.
export const SHADOW_ROW_OFFSET = 40
export const shadowReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/AdvancedDatFileReader.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/translator/ShadowTranslator.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/shadowmap/ShadowMapping.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/shadowmap/IdentityShadowMapping.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/ImageProvider.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/MapObjectDrawer.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/MapContent.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/MapDrawContext.java',
  'go.graphics.swing/src/main/java/go/graphics/swing/opengl/LWJGLDrawContext.java',
  'go.graphics.swing/src/main/glsl/go/graphics/swing/gl33/unified.frag',
] as const
