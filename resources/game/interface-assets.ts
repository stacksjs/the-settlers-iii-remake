// Original image selectors and resolution sizes from JSettlers' pinned
// MainPanel, ControlPanelLayoutProperties and MiniMapLayoutProperties.
// See third-party/settlers-remake-LICENSE.txt. These are asset identities,
// not evidence of original game rules or a completed native HUD.
export interface InterfaceImage {
  key: string
  path: string
  kind: 'background' | 'control'
  file: number
  section: number
  sequence: number
  frame: number
  width: number
  height: number
}

const profiles = [
  [480, 136, 338, 142, 71],
  [600, 176, 430, 170, 84],
  [768, 216, 544, 224, 117],
] as const

const backgrounds: InterfaceImage[] = profiles.flatMap(([profile, width, panelHeight, minimapHeight, rightWidth], frame) => [
  { key: `panel-${profile}`, sequence: 2, width, height: panelHeight },
  { key: `panel-right-${profile}`, sequence: 3, width: 8, height: panelHeight },
  { key: `minimap-${profile}`, sequence: 0, width, height: minimapHeight },
  { key: `minimap-right-${profile}`, sequence: 1, width: rightWidth, height: minimapHeight },
].map(image => ({ ...image, path: `ui/${image.key}.png`, kind: 'background', file: 4, section: 0x106, frame })))

const buttons = [
  ['build', 51, 60, 33, 33], ['goods', 54, 63, 33, 33], ['settlers', 57, 66, 33, 33],
  ['build-resources', 69, 81, 27, 24], ['build-food', 72, 84, 27, 24],
  ['build-military', 75, 87, 27, 24], ['build-social', 78, 90, 27, 24],
  ['goods-stock', 258, 270, 27, 24], ['goods-tools', 261, 273, 27, 24],
  ['goods-distribution', 264, 276, 27, 24], ['goods-transport', 267, 279, 27, 24],
  ['settlers-statistics', 234, 246, 27, 24], ['settlers-professions', 237, 249, 27, 24],
  ['settlers-warriors', 240, 252, 27, 24], ['settlers-production', 243, 255, 27, 24],
  ['system', 93, 96, 18, 27],
  ['lower-scroll', 111, 99, 24, 24], ['lower-swords', 114, 102, 24, 24],
  ['lower-signpost', 117, 105, 24, 24], ['lower-pots', 120, 108, 24, 24],
] as const

const controls: InterfaceImage[] = buttons.flatMap(([key, inactive, active, width, height]) => [
  { key: `${key}-inactive`, sequence: inactive }, { key: `${key}-active`, sequence: active },
].map(image => ({ ...image, path: `ui/${image.key}.png`, kind: 'control', file: 3, section: 0x11306, frame: 0, width, height })))

export const interfaceImages: readonly InterfaceImage[] = [...backgrounds, ...controls]

export const interfaceReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/controls/original/ControlPanelLayoutProperties.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/controls/original/MiniMapLayoutProperties.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/controls/original/panel/MainPanel.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/controls/original/panel/TabButton.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/translator/GuiTranslator.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/DatBitmapReader.java',
] as const
