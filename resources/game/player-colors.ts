// Palette from the pinned reference MapDrawContext. Its first 20 slots were
// copied by that author from an original editor screenshot; the final 12 are
// remake additions. These are not measured Gold runtime pixel colors.
export type RGB = readonly [number, number, number]
const colors: readonly RGB[] = [
  [247, 16, 0],
  [16, 140, 247],
  [247, 247, 0],
  [41, 181, 82],
  [247, 140, 0],
  [0, 247, 247],
  [247, 0, 247],
  [41, 41, 41],
  [247, 247, 247],
  [0, 16, 247],
  [206, 74, 16],
  [140, 140, 140],
  [173, 8, 222],
  [0, 107, 0],
  [247, 189, 189],
  [132, 239, 165],
  [156, 8, 49],
  [206, 140, 231],
  [247, 206, 148],
  [140, 189, 239],
  [186, 255, 69],
  [205, 9, 115],
  [217, 241, 175],
  [110, 0, 95],
  [163, 197, 3],
  [100, 179, 185],
  [179, 246, 251],
  [142, 89, 43],
  [142, 136, 43],
  [217, 224, 255],
  [212, 212, 212],
  [255, 87, 143],
]
export const PLAYER_PALETTE: readonly RGB[] = Object.freeze(colors.map(color => Object.freeze(color)))
export const NEUTRAL_RGB: RGB = Object.freeze([0, 0, 0])
export const DEFAULT_PLAYER_SLOTS: readonly number[] = Object.freeze(Array.from({ length: 20 }, (_, index) => index))
export const playerColorReferences = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/MapDrawContext.java',
  'go.graphics.swing/src/main/glsl/go/graphics/swing/gl33/unified.frag',
] as const
export interface PlayerSlotEntry { readonly id: string, readonly digest: string, readonly slots: readonly number[] }
export type PlayerSlotCatalog = readonly PlayerSlotEntry[]

export function paletteRGB(slot: number): RGB {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PLAYER_PALETTE.length) throw new RangeError('Invalid player palette slot')
  return PLAYER_PALETTE[slot]!
}
export function playerRGB(slots: readonly number[], player: number): RGB {
  if (!Number.isInteger(player) || player < 0) throw new RangeError('Invalid player identity')
  return player === 0 ? NEUTRAL_RGB : paletteRGB(slots[player - 1] ?? -1)
}
export const playerCSS = (slots: readonly number[], player: number): string => `rgb(${playerRGB(slots, player).join(',')})`

/** Validate immutable presentation metadata independently from simulation saves. */
export function validatePlayerSlotCatalog(raw: unknown): PlayerSlotCatalog {
  if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Invalid original player-color catalog')
  const seen = new Set<string>()
  return Object.freeze(raw.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id.startsWith('demo:') || entry.id.length > 300
      || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)
      || !Array.isArray(entry.slots) || !entry.slots.length || entry.slots.length > 20
      || entry.slots.some((slot: unknown) => !Number.isInteger(slot) || Number(slot) < 0 || Number(slot) >= 32)
      || new Set(entry.slots).size !== entry.slots.length || seen.has(entry.id + ':' + entry.digest)) throw new Error('Invalid original player-color catalog')
    seen.add(entry.id + ':' + entry.digest)
    return Object.freeze({ id: entry.id, digest: entry.digest, slots: Object.freeze([...entry.slots] as number[]) })
  }))
}

/** Original content resolves by exact identity, retaining filtered original slots.
 * The Roman v1 mapping is immutable. New civilization support needs a new content
 * identity rather than reinterpreting the ids stored by existing saves/replays. */
export function playerSlotsForContent(content: { id: string, digest: string }, count: number, catalog: PlayerSlotCatalog): readonly number[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new RangeError('Invalid player count')
  const entry = catalog.find(entry => entry.id === content.id && entry.digest === content.digest)
  if (entry) {
    if (entry.slots.length < count) throw new Error('Original map player-color mapping has too few players')
    return Object.freeze(entry.slots.slice(0, count))
  }
  if (/^generated(?:-\d+)?$/.test(content.id) || /^rival-\d+-elimination-v1$/.test(content.id)) return Object.freeze(DEFAULT_PLAYER_SLOTS.slice(0, count))
  throw new Error('Player colors for this saved content are unavailable. Update its content files.')
}

/** Grayscale multiplication mirrors the reference torso shader, with byte
 * rounding for the browser's RGBA8 target. Source masks remain unchanged. */
export function colorTorsoPixels(gray: Uint8ClampedArray, slot: number): Uint8ClampedArray<ArrayBuffer> {
  if (gray.length % 4) throw new Error('Invalid torso pixel buffer')
  const rgb = paletteRGB(slot), pixels = new Uint8ClampedArray(gray)
  for (let p = 0; p < gray.length; p += 4) {
    if (!gray[p + 3]) continue
    if (gray[p] !== gray[p + 1] || gray[p] !== gray[p + 2]) throw new Error('Torso mask is not grayscale')
    for (let c = 0; c < 3; c++) pixels[p + c] = Math.round(gray[p + 2]! * rgb[c]! / 255)
  }
  return pixels
}

/** Original sprites whose source may provide a separate player-color layer. */
export const isPlayerSprite = (key: string): boolean => key === 'border-post' || key === 'worker' || key === 'priest' || key.startsWith('carry:') || key.startsWith('soldier:') || key.startsWith('strike:') || ['geologist', 'geologist-survey-1', 'geologist-survey-2'].includes(key)
