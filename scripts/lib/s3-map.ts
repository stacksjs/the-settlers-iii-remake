// Map layout, part encryption and checksum adapted from JSettlers' MIT-licensed
// OriginalMapFileContentReader and original map data enums (2015-2017).
// See third-party/settlers-remake-LICENSE.txt.

export const MAP_REFERENCE = { repository: 'paulwedeck/settlers-remake', revision: '6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0', evidence: 'reference-remake' } as const
export const MAP_LIMITS = { maxBytes: 16 * 1024 * 1024, maxDimension: 1024, maxParts: 1024, maxPlayers: 20 } as const
export const MAP_PART = { eof: 0, mapInfo: 1, playerInfo: 2, teamInfo: 3, preview: 4, unknown5: 5, area: 6, settlers: 7, buildings: 8, stacks: 9, victory: 10, questText: 11, questTip: 12 } as const

const list = (names: string): string[] => names.split(' ')
export const REFERENCE_NAMES = {
  evidence: MAP_REFERENCE.evidence,
  parts: list('EOF MAP_INFO PLAYER_INFO TEAM_INFO PREVIEW UNKNOWN_5 AREA SETTLERS BUILDINGS STACKS WIN_COND QUEST_TEXT QUEST_TIP'),
  versions: { 10: 'DEFAULT', 11: 'AMAZONS' } as Record<number, string>,
  civilizations: { 0: 'ROMANS', 1: 'EGYPTIANS', 2: 'ASIANS', 3: 'AMAZONS', 255: 'FREE_CHOICE' } as Record<number, string>,
  resources: list('FISH COAL IRONORE GOLDORE GEMS SULFUR'),
  settlers: list('BEARER DIGGER BRICKLAYER LUMBERJACK STONECUTTER SWORDSMAN_L1 SAWMILLER FORESTER BOWMAN_L1 MELTER MINER SMITH MILLER BAKER BUTCHER PIKEMAN_L1 FARMER FISHERMAN WATERWORKER Werftarbeiter UNKNOWN_20 HEALER GEOLOGIST THIEF CHARCOAL_BURNER DISTILLER BREWER Pulvermacher PIG_FARMER WINEGROWER BOWMAN_L2 PIKEMAN_L2 SWORDSMAN_L2 BOWMAN_L3 PIKEMAN_L3 SWORDSMAN_L3 MAGE UNKNOWN_37 Reisbauer DONKEY PIONEER Katapult UNKNOWN_42 CARGO_SHIP FERRY BEEKEEPER Metwinzer Alchemist'),
  stacks: list('- PLANK STONE TRUNK BREAD COAL GOLDORE IRONORE FISH CROP GOLD IRON SPADE HAMMER AXE PICK SAW FISHINGROD SWORD BOW SPEAR WINE FLOUR PIG MEAT SULFUR WATER RICE GEMS KEG Schiesspulver unknown SCYTHE Reisschnaps Met HONEY'),
  buildings: list('- STOCK LUMBERJACK STONECUTTER SAWMILL FORESTER LOOKOUT_TOWER COALMINE GOLDMINE IRONMINE GOLDMELT Eisenschmelze TOOLSMITH WEAPONSMITH WINEGROWER TOWER TOWER_BIG Muehle CASTLE BARRACK BAKER Metzger Destille PIG_FARM FARM FISHER LIVINGHOUSE_SMALL LIVINGHOUSE_MEDIUM LIVINGHOUSE_BIG SULFURMINE WATERWORKS Katapultwerk DOCKYARD HARBOR Marktplatz HOSPITAL Reisfarm GEMSMINE Brauerei CHARCOAL_BURNER Pulvermacherei Pyramide Sphinx BIG_TEMPLE TEMPLE grosse_Pagode kleine_Pagode Ballistenwerkstatt Kanonenwerkstatt DONKEY_FARM grosser_Gong BEEKEEPING Metwinzerei Labortorium kleiner_Tempel grosser_Tempel SULFURMINE_AMAZON'),
}
const named = (names: string[], id: number): string | null => { const name = names[id]; return name && name !== '-' ? name : null }
export function referenceObjectClass(id: number): 'decoration' | 'tree' | 'stone' | null {
  if (id >= 1 && id <= 8) return 'decoration'
  if ((id >= 68 && id <= 80) || id === 84) return 'tree'
  return id >= 115 && id <= 127 ? 'stone' : null
}

export type MapDecodeErrorCode = 'file-too-large' | 'truncated' | 'unsupported-version' | 'checksum-mismatch' | 'invalid-part-length' | 'part-out-of-bounds' | 'too-many-parts' | 'duplicate-part' | 'missing-part' | 'dimension-limit' | 'invalid-record'
export class MapDecodeError extends Error {
  constructor(readonly code: MapDecodeErrorCode, message: string, readonly offset: number | null = null) {
    super(message)
    this.name = 'MapDecodeError'
  }
}
export type MapDiagnosticCode = 'checksum-mismatch' | 'unsupported-part' | 'uninterpreted-bytes' | 'unnamed-id' | 'unterminated-text' | 'interpretation'
export interface MapDiagnostic { code: MapDiagnosticCode, partType: number | null, offset: number | null, length: number | null, message: string }
export interface MapPart { type: number, sub: number, offset: number, length: number, referenceName: string | null, decoded: boolean }
export interface MapPlayer { index: number, civilization: number, civilizationReferenceName: string | null, startX: number, startY: number, name: string }
export interface MapTeamSet { sub: number, name: string, tail: number[] }
export interface MapArea { size: number, elevation: Uint8Array, landscape: Uint8Array, objects: Uint8Array, owner: Uint8Array, accessibility: Uint8Array, resourceType: Uint8Array, resourceAmount: Uint8Array }
export interface MapPreview { size: number, unknown: number, pixels565: Uint16Array }
export interface MapSettler { player: number, type: number, referenceName: string | null, x: number, y: number }
export interface MapSoldiers { sword1: number, sword2: number, sword3: number, archer1: number, archer2: number, archer3: number, spear1: number, spear2: number, spear3: number }
export interface MapBuilding { player: number, type: number, referenceName: string | null, x: number, y: number, flags: number, soldierNibbles: number[], soldiers: MapSoldiers }
export interface MapStack { x: number, y: number, type: number, referenceName: string | null, amount: number, trailer: number }
export interface MapVictory {
  killPlayers: { enabled: boolean, players: boolean[] }
  destroyBuildings: { enabled: boolean, targets: { player: number, building: number }[] }
  conquerPositions: { enabled: boolean, positions: { enabled: boolean, x: number, y: number }[] }
  survive: { enabled: boolean, durations: number[] }
  produceGoods: { enabled: boolean, goals: { amount: number, good: number }[] }
}
export interface OriginalMap {
  format: { bytes: number, version: number, versionReferenceName: string, checksum: { stored: number, computed: number, valid: boolean }, paddingBytes: number }
  parts: MapPart[]
  info: { singlePlayer: boolean, playerCount: number, startResources: number }
  players: MapPlayer[]
  teams: MapTeamSet[]
  area: MapArea
  preview: MapPreview | null
  settlers: MapSettler[]
  buildings: MapBuilding[]
  stacks: MapStack[]
  victory: MapVictory | null
  questText: string | null
  questTip: string | null
  diagnostics: MapDiagnostic[]
  evidence: { reference: typeof MAP_REFERENCE, names: string }
}
export interface MapDecodeOptions { maxBytes?: number, maxDimension?: number, maxParts?: number, requireValidChecksum?: boolean }

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
export function mapChecksum(bytes: Uint8Array): number {
  const view = viewOf(bytes), end = bytes.length & ~3
  let sum = 0
  for (let i = 8; i < end; i += 4) sum = ((sum >>> 31) | ((sum << 1) ^ view.getUint32(i, true))) >>> 0
  return sum
}
export function cryptMapPart(data: Uint8Array, type: number, direction: 'decrypt' | 'encrypt'): Uint8Array {
  const out = new Uint8Array(data.length)
  let key = type & 255
  for (let i = 0; i < data.length; i++) {
    const plain = direction === 'decrypt' ? data[i]! ^ key : data[i]!
    out[i] = direction === 'decrypt' ? plain : plain ^ key
    key = ((key << 1) ^ plain) & 255
  }
  return out
}
export interface EncodedMapPart { type: number, sub?: number, data: Uint8Array }
export function encodeOriginalMap(version: number, parts: EncodedMapPart[]): Uint8Array {
  const body = parts.reduce((sum, part) => sum + 8 + part.data.length, 8 + 8)
  const bytes = new Uint8Array(Math.ceil(body / 4) * 4), view = viewOf(bytes)
  view.setUint32(4, version, true)
  let at = 8
  for (const part of parts) {
    view.setUint32(at, (((part.sub ?? 0) << 16) | (part.type & 0xFFFF)) >>> 0, true)
    view.setUint32(at + 4, part.data.length + 8, true)
    bytes.set(cryptMapPart(part.data, part.type, 'encrypt'), at + 8)
    at += part.data.length + 8
  }
  view.setUint32(at + 4, 8, true)
  view.setUint32(0, mapChecksum(bytes), true)
  return bytes
}

function latin1(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}
class Part {
  readonly view: DataView
  constructor(readonly type: number, readonly offset: number, readonly data: Uint8Array) { this.view = viewOf(data) }
  fail(message: string, at = 0): MapDecodeError { return new MapDecodeError('invalid-record', `${REFERENCE_NAMES.parts[this.type]} part at file offset ${this.offset - 8}: ${message}`, this.offset + at) }
  need(bytes: number, what: string): void { if (this.data.length < bytes) throw this.fail(`${what} needs ${bytes} bytes but the part holds ${this.data.length}`) }
  u8(at: number): number { this.need(at + 1, 'read'); return this.data[at]! }
  u16(at: number): number { this.need(at + 2, 'read'); return this.view.getUint16(at, true) }
  u32(at: number): number { this.need(at + 4, 'read'); return this.view.getUint32(at, true) }
  bool(at: number): boolean {
    const value = this.u8(at)
    if (value > 1) throw this.fail(`byte ${at} holds ${value}, not a 0 or 1 flag`, at)
    return value === 1
  }
  records(size: number): number {
    const count = this.u32(0)
    if (count > Math.floor((this.data.length - 4) / size)) throw this.fail(`declares ${count} records of ${size} bytes, more than the ${this.data.length - 4} remaining bytes hold`)
    return count
  }
  text(start: number, length: number): { text: string, terminated: boolean, residue: number } {
    const field = this.data.subarray(start, start + length), end = field.indexOf(0)
    const residue = end < 0 ? 0 : field.subarray(end).reduce((sum, byte) => sum + (byte ? 1 : 0), 0)
    return { text: latin1(end < 0 ? field : field.subarray(0, end)), terminated: end >= 0, residue }
  }
}

export function decodeOriginalMap(bytes: Uint8Array, options: MapDecodeOptions = {}): OriginalMap {
  const maxBytes = options.maxBytes ?? MAP_LIMITS.maxBytes, maxDimension = options.maxDimension ?? MAP_LIMITS.maxDimension, maxParts = options.maxParts ?? MAP_LIMITS.maxParts
  if (bytes.length > maxBytes) throw new MapDecodeError('file-too-large', `Map file has ${bytes.length} bytes, above the ${maxBytes} byte limit`)
  if (bytes.length < 16) throw new MapDecodeError('truncated', `Map file has ${bytes.length} bytes, below the 16 byte header and end part`, 0)
  const view = viewOf(bytes), diagnostics: MapDiagnostic[] = []
  const note = (code: MapDiagnosticCode, partType: number | null, offset: number | null, length: number | null, message: string): void => { diagnostics.push({ code, partType, offset, length, message }) }
  const version = view.getUint32(4, true), versionReferenceName = REFERENCE_NAMES.versions[version]
  if (!versionReferenceName) throw new MapDecodeError('unsupported-version', `Map file version ${version} is not one of the supported versions 10 (DEFAULT) or 11 (AMAZONS)`, 4)
  const stored = view.getUint32(0, true), computed = mapChecksum(bytes)
  if (stored !== computed) {
    if (options.requireValidChecksum !== false) throw new MapDecodeError('checksum-mismatch', `Stored checksum ${stored} does not match computed checksum ${computed}`, 0)
    note('checksum-mismatch', null, 0, 4, `Stored checksum ${stored} does not match computed checksum ${computed}; decoded because the checksum requirement was disabled`)
  }

  const parts: MapPart[] = [], found = new Map<number, Part>(), teamParts: { sub: number, part: Part }[] = []
  let at = 8, paddingBytes = 0
  for (;;) {
    if (at + 8 > bytes.length) throw new MapDecodeError('truncated', `Part header at file offset ${at} runs past the ${bytes.length} byte file before an end part`, at)
    const raw = view.getUint32(at, true), length = view.getUint32(at + 4, true)
    if (raw === 0) { paddingBytes = bytes.length - at - 8; break }
    if (parts.length >= maxParts) throw new MapDecodeError('too-many-parts', `Map file has more than ${maxParts} parts`, at)
    if (length < 8) throw new MapDecodeError('invalid-part-length', `Part at file offset ${at} declares length ${length}, below its 8 byte header`, at + 4)
    if (at + length > bytes.length) throw new MapDecodeError('part-out-of-bounds', `Part at file offset ${at} declares length ${length}, ending ${at + length - bytes.length} bytes past the file`, at + 4)
    const type = raw & 0xFFFF, sub = raw >>> 16, referenceName = type <= 12 ? REFERENCE_NAMES.parts[type]! : null
    const decoded = referenceName !== null && type !== MAP_PART.eof && type !== MAP_PART.unknown5
    parts.push({ type, sub, offset: at, length, referenceName, decoded })
    if (!decoded) note('unsupported-part', type, at, length, `Part type ${type} (sub ${sub}) at file offset ${at}, ${length - 8} payload bytes: ${referenceName ? 'the reference names it but defines no decoder' : 'not a reference part type'}; contents not decoded`)
    else {
      const part = new Part(type, at + 8, cryptMapPart(bytes.subarray(at + 8, at + length), type, 'decrypt'))
      if (type === MAP_PART.teamInfo) teamParts.push({ sub, part })
      else if (found.has(type)) throw new MapDecodeError('duplicate-part', `Part type ${type} (${referenceName}) appears more than once; second copy at file offset ${at}`, at)
      else found.set(type, part)
    }
    at += length
  }
  if (paddingBytes > 3) note('uninterpreted-bytes', MAP_PART.eof, bytes.length - paddingBytes, paddingBytes, `${paddingBytes} bytes follow the end part, more than 4 byte alignment padding`)
  const require = (type: number): Part => {
    const part = found.get(type)
    if (!part) throw new MapDecodeError('missing-part', `Required ${REFERENCE_NAMES.parts[type]} part (type ${type}) is absent`)
    return part
  }
  const residue = (part: Part, used: number, what: string): void => {
    const rest = part.data.subarray(used), nonzero = rest.reduce((sum, byte) => sum + (byte ? 1 : 0), 0)
    if (nonzero) note('uninterpreted-bytes', part.type, part.offset + used, rest.length, `${rest.length} bytes after ${what} are not interpreted (${nonzero} nonzero)`)
  }
  const unnamed = (part: Part, ids: Iterable<number>, what: string): void => {
    const distinct = [...new Set(ids)].sort((a, b) => a - b)
    if (distinct.length) note('unnamed-id', part.type, part.offset, part.data.length, `${what} ids without a reference name: ${distinct.join(', ')}`)
  }

  const infoPart = require(MAP_PART.mapInfo)
  infoPart.need(12, 'map info')
  const mapType = infoPart.u32(0), playerCount = infoPart.u32(4), startResources = infoPart.u32(8)
  if (mapType > 1) throw infoPart.fail(`map type ${mapType} is neither 0 (multiplayer) nor 1 (single player)`)
  if (playerCount < 1 || playerCount > MAP_LIMITS.maxPlayers) throw infoPart.fail(`player count ${playerCount} is outside 1 to ${MAP_LIMITS.maxPlayers}`, 4)
  residue(infoPart, 12, 'map type, player count and start resources')

  const areaPart = require(MAP_PART.area)
  const size = areaPart.u32(0)
  if (size < 1 || size > maxDimension) throw new MapDecodeError('dimension-limit', `Area declares ${size}x${size} tiles, outside 1 to ${maxDimension}`, areaPart.offset)
  const tiles = size * size
  areaPart.need(4 + tiles * 6, `${size}x${size} area`)
  const field = (): Uint8Array => new Uint8Array(tiles)
  const area: MapArea = { size, elevation: field(), landscape: field(), objects: field(), owner: field(), accessibility: field(), resourceType: field(), resourceAmount: field() }
  for (let i = 0, p = 4; i < tiles; i++, p += 6) {
    const d = areaPart.data
    area.elevation[i] = d[p]!; area.landscape[i] = d[p + 1]!; area.objects[i] = d[p + 2]!; area.owner[i] = d[p + 3]!; area.accessibility[i] = d[p + 4]!
    area.resourceType[i] = d[p + 5]! >> 4; area.resourceAmount[i] = d[p + 5]! & 15
  }
  residue(areaPart, 4 + tiles * 6, 'the tile records')
  const objectIds: number[] = [], resourceIds: number[] = []
  for (let i = 0; i < tiles; i++) {
    if (area.objects[i] && !referenceObjectClass(area.objects[i]!)) objectIds.push(area.objects[i]!)
    if (area.resourceAmount[i] && area.resourceType[i]! >= REFERENCE_NAMES.resources.length) resourceIds.push(area.resourceType[i]!)
  }
  const distinctObjects = [...new Set(objectIds)].sort((a, b) => a - b)
  if (distinctObjects.length) note('unnamed-id', MAP_PART.area, areaPart.offset, areaPart.data.length, `${objectIds.length} object tiles use ${distinctObjects.length} ids the reference gives no tree, stone or decoration class: ${distinctObjects.join(', ')}`)
  unnamed(areaPart, resourceIds, 'Resource type')
  const inside = (part: Part, x: number, y: number, at: number, what: string): void => { if (x >= size || y >= size) throw part.fail(`${what} position ${x},${y} lies outside the ${size}x${size} area`, at) }

  const playerPart = require(MAP_PART.playerInfo)
  playerPart.need(playerCount * 45, `${playerCount} player records`)
  const players: MapPlayer[] = []
  for (let index = 0; index < playerCount; index++) {
    const p = index * 45, civilization = playerPart.u32(p), startX = playerPart.u32(p + 4), startY = playerPart.u32(p + 8), name = playerPart.text(p + 12, 33)
    inside(playerPart, startX, startY, p + 4, `player ${index} start`)
    if (name.residue) note('uninterpreted-bytes', MAP_PART.playerInfo, playerPart.offset + p + 12, 33, `player ${index} name field holds ${name.residue} nonzero bytes after its terminator`)
    players.push({ index, civilization, civilizationReferenceName: REFERENCE_NAMES.civilizations[civilization] ?? null, startX, startY, name: name.text })
  }
  unnamed(playerPart, players.filter(player => player.civilizationReferenceName === null).map(player => player.civilization), 'Civilization')
  residue(playerPart, playerCount * 45, 'the player records')

  const teams = teamParts.map(({ sub, part }) => {
    part.need(33, 'team set name')
    return { sub, name: part.text(0, 33).text, tail: [...part.data.subarray(33)] }
  })
  const teamTail = teams.reduce((sum, team) => sum + team.tail.length, 0)
  if (teamParts.length && teamTail) note('uninterpreted-bytes', MAP_PART.teamInfo, teamParts[0]!.part.offset + 33, teamTail, `${teamParts.length} team set records carry ${teamTail} bytes after their 33 byte names; the reference defines no TEAM_INFO decoder, so they are kept raw and not interpreted`)

  let preview: MapPreview | null = null
  const previewPart = found.get(MAP_PART.preview)
  if (previewPart) {
    const side = previewPart.u16(0), unknown = previewPart.u16(2)
    if (side > maxDimension) throw new MapDecodeError('dimension-limit', `Preview declares ${side}x${side} pixels, above ${maxDimension}`, previewPart.offset)
    previewPart.need(4 + side * side * 2, `${side}x${side} preview`)
    const pixels565 = new Uint16Array(side * side)
    for (let i = 0; i < pixels565.length; i++) pixels565[i] = previewPart.view.getUint16(4 + i * 2, true)
    if (unknown) note('uninterpreted-bytes', MAP_PART.preview, previewPart.offset + 2, 2, `preview word 2 holds ${unknown}; its meaning is unknown`)
    residue(previewPart, 4 + side * side * 2, 'the preview pixels')
    preview = { size: side, unknown, pixels565 }
  }

  const settlers: MapSettler[] = [], settlerPart = found.get(MAP_PART.settlers)
  if (settlerPart) {
    const count = settlerPart.records(6)
    for (let i = 0, p = 4; i < count; i++, p += 6) {
      const settler = { player: settlerPart.u8(p), type: settlerPart.u8(p + 1), referenceName: named(REFERENCE_NAMES.settlers, settlerPart.u8(p + 1)), x: settlerPart.u16(p + 2), y: settlerPart.u16(p + 4) }
      inside(settlerPart, settler.x, settler.y, p + 2, `settler ${i}`)
      settlers.push(settler)
    }
    unnamed(settlerPart, settlers.filter(item => !item.referenceName).map(item => item.type), 'Settler type')
    residue(settlerPart, 4 + count * 6, 'the settler records')
  }

  const buildings: MapBuilding[] = [], buildingPart = found.get(MAP_PART.buildings)
  if (buildingPart) {
    const count = buildingPart.records(12)
    let flagged = 0, spare = 0
    for (let i = 0, p = 4; i < count; i++, p += 12) {
      const soldierNibbles = [...buildingPart.data.subarray(p + 7, p + 12)].flatMap(byte => [byte >> 4, byte & 15])
      const [sword1, sword2, archer2, archer3, sword3, archer1, spear3, unused, spear1, spear2] = soldierNibbles as [number, number, number, number, number, number, number, number, number, number]
      const building = { player: buildingPart.u8(p), type: buildingPart.u8(p + 1), referenceName: named(REFERENCE_NAMES.buildings, buildingPart.u8(p + 1)), x: buildingPart.u16(p + 2), y: buildingPart.u16(p + 4), flags: buildingPart.u8(p + 6), soldierNibbles, soldiers: { sword1, sword2, sword3, archer1, archer2, archer3, spear1, spear2, spear3 } }
      inside(buildingPart, building.x, building.y, p + 2, `building ${i}`)
      if (building.flags) flagged++
      if (unused) spare++
      buildings.push(building)
    }
    if (flagged) note('uninterpreted-bytes', MAP_PART.buildings, buildingPart.offset + 4 + 6, flagged, `${flagged} of ${count} building records have a nonzero byte 6, which the reference skips as unused`)
    if (spare) note('uninterpreted-bytes', MAP_PART.buildings, buildingPart.offset + 4 + 10, spare, `${spare} of ${count} building records have a nonzero low nibble in byte 10, which the reference leaves unlabeled`)
    unnamed(buildingPart, buildings.filter(item => !item.referenceName).map(item => item.type), 'Building type')
    residue(buildingPart, 4 + count * 12, 'the building records')
  }

  const stacks: MapStack[] = [], stackPart = found.get(MAP_PART.stacks)
  if (stackPart) {
    const count = stackPart.records(8)
    for (let i = 0, p = 4; i < count; i++, p += 8) {
      const stack = { x: stackPart.u16(p), y: stackPart.u16(p + 2), type: stackPart.u8(p + 4), referenceName: named(REFERENCE_NAMES.stacks, stackPart.u8(p + 4)), amount: stackPart.u8(p + 5), trailer: stackPart.u16(p + 6) }
      inside(stackPart, stack.x, stack.y, p, `stack ${i}`)
      stacks.push(stack)
    }
    const trailers = [...new Set(stacks.filter(stack => stack.trailer).map(stack => stack.trailer))].sort((a, b) => a - b)
    if (trailers.length) note('uninterpreted-bytes', MAP_PART.stacks, stackPart.offset + 4 + 6, stacks.filter(stack => stack.trailer).length, `${stacks.filter(stack => stack.trailer).length} of ${count} stack records carry nonzero bytes 6-7, which the reference skips as padding (values ${trailers.map(value => `0x${value.toString(16).padStart(4, '0')}`).join(', ')})`)
    unnamed(stackPart, stacks.filter(item => !item.referenceName).map(item => item.type), 'Stack type')
    residue(stackPart, 4 + count * 8, 'the stack records')
  }

  let victory: MapVictory | null = null
  const victoryPart = found.get(MAP_PART.victory)
  if (victoryPart) {
    const v = victoryPart, range = (length: number): number[] => Array.from({ length }, (_, i) => i)
    v.need(119, 'victory conditions')
    victory = {
      killPlayers: { enabled: v.bool(0), players: range(20).map(i => v.bool(1 + i)) },
      destroyBuildings: { enabled: v.bool(21), targets: range(10).map(i => ({ player: v.u8(22 + i * 2), building: v.u8(23 + i * 2) })) },
      conquerPositions: { enabled: v.bool(42), positions: range(5).map(i => ({ enabled: v.bool(43 + i * 5), x: v.u16(44 + i * 5), y: v.u16(46 + i * 5) })) },
      survive: { enabled: v.bool(68), durations: range(20).map(i => v.u16(69 + i * 2)) },
      produceGoods: { enabled: v.bool(109), goals: range(3).map(i => ({ amount: v.u16(110 + i * 3), good: v.u8(112 + i * 3) })) },
    }
    note('interpretation', MAP_PART.victory, v.offset + 109, 10, 'produce-goods goals are read as a 16-bit amount followed by a good id byte; the reference reads the good id from the high byte of the amount, so this layout is an unverified engineering reading')
    residue(v, 119, 'the victory conditions')
  }

  const text = (type: number): string | null => {
    const part = found.get(type)
    if (!part) return null
    const value = part.text(0, part.data.length)
    if (!value.terminated) note('unterminated-text', type, part.offset, part.data.length, `${REFERENCE_NAMES.parts[type]} has no terminating zero byte`)
    if (value.residue) note('uninterpreted-bytes', type, part.offset, part.data.length, `${REFERENCE_NAMES.parts[type]} holds ${value.residue} nonzero bytes after its terminator`)
    return value.text
  }
  const questText = text(MAP_PART.questText), questTip = text(MAP_PART.questTip)
  return {
    format: { bytes: bytes.length, version, versionReferenceName, checksum: { stored, computed, valid: stored === computed }, paddingBytes },
    parts,
    info: { singlePlayer: mapType === 1, playerCount, startResources },
    players,
    teams,
    area,
    preview,
    settlers,
    buildings,
    stacks,
    victory,
    questText,
    questTip,
    diagnostics,
    evidence: { reference: MAP_REFERENCE, names: 'Reference names and object classes come from the reference remake and are not original facts' },
  }
}

export function summarizeOriginalMap(map: OriginalMap): Record<string, number> {
  const { area } = map, tiles = area.size * area.size
  let elevated = 0, landscaped = 0, objects = 0, trees = 0, stones = 0, decorations = 0, resources = 0
  const landscapes = new Set<number>()
  for (let i = 0; i < tiles; i++) {
    landscapes.add(area.landscape[i]!)
    if (area.elevation[i]) elevated++
    if (area.landscape[i]) landscaped++
    if (area.resourceAmount[i]) resources++
    const object = area.objects[i]!, kind = referenceObjectClass(object)
    if (object) objects++
    if (kind === 'tree') trees++
    else if (kind === 'stone') stones++
    else if (kind === 'decoration') decorations++
  }
  return {
    size: area.size,
    tiles,
    players: map.players.length,
    teamSets: map.teams.length,
    elevatedTiles: elevated,
    nonzeroLandscapeTiles: landscaped,
    distinctLandscapeIds: landscapes.size,
    objectTiles: objects,
    referenceTreeTiles: trees,
    referenceStoneTiles: stones,
    referenceDecorationTiles: decorations,
    resourceTiles: resources,
    settlers: map.settlers.length,
    buildings: map.buildings.length,
    stacks: map.stacks.length,
    questTextCharacters: map.questText?.length ?? 0,
    questTipCharacters: map.questTip?.length ?? 0,
  }
}
