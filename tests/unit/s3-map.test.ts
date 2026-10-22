import type { EncodedMapPart, MapDecodeErrorCode } from '../../scripts/lib/s3-map'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'
import { cryptMapPart, decodeOriginalMap, encodeOriginalMap, MAP_PART, MapDecodeError, mapChecksum, summarizeOriginalMap } from '../../scripts/lib/s3-map'
import { DEMO_ARCHIVE, DEMO_INVENTORY, inspectDemoMap, loadDemoMaps, mapReceipt, sha256 } from '../../scripts/maps'

const words = (size: 2 | 4, ...values: number[]): number[] => values.flatMap(value => Array.from({ length: size }, (_, i) => (value >>> (i * 8)) & 255))
const text = (value: string, length: number): number[] => Array.from({ length }, (_, i) => value.charCodeAt(i) || 0)
const part = (type: number, data: number[], sub = 0): EncodedMapPart => ({ type, sub, data: Uint8Array.from(data) })
function area(size = 4): number[] {
  const tiles = Array.from({ length: size * size }, (_, i) => [i, i % 3, [68, 115, 9][i] ?? 0, 255, 1, i === 3 ? 0x15 : 0])
  return [...words(4, size), ...tiles.flat()]
}
function victory(): number[] {
  const bytes = Array.from<number>({ length: 119 }).fill(0)
  bytes[0] = 1; bytes[2] = 1
  for (let i = 0; i < 10; i++) { bytes[22 + i * 2] = 255; bytes[23 + i * 2] = 1 }
  bytes[42] = 1; bytes[43] = 1; bytes[44] = 2; bytes[46] = 3
  bytes[109] = 1; bytes[110] = 50; bytes[112] = 1
  return bytes
}
function parts(): EncodedMapPart[] {
  return [
    part(66, [1, 2, 3, 4]),
    part(MAP_PART.mapInfo, [...words(4, 1, 2, 2), ...Array.from<number>({ length: 12 }).fill(0)]),
    part(MAP_PART.playerInfo, [...words(4, 3, 1, 2), ...text('Ana', 33), ...words(4, 255, 3, 3), ...text('', 33)]),
    part(MAP_PART.teamInfo, [...text('Team', 33), 0, 1, 1, 2]),
    part(MAP_PART.preview, [...words(2, 2, 0, 0xF800, 0x07E0, 0x001F, 0xFFFF)]),
    part(MAP_PART.area, area()),
    part(MAP_PART.settlers, [...words(4, 1), 0, 0, ...words(2, 1, 1)]),
    part(MAP_PART.buildings, [...words(4, 1), 1, 15, ...words(2, 2, 2), 0, 0x12, 0x34, 0x56, 0x70, 0x89]),
    part(MAP_PART.stacks, [...words(4, 1), ...words(2, 0, 3), 1, 8, 0, 0]),
    part(MAP_PART.victory, victory()),
    part(MAP_PART.questText, text('Win.', 5)),
    part(MAP_PART.questTip, text('Tip', 4)),
  ]
}
const replace = (list: EncodedMapPart[], type: number, data: number[]): EncodedMapPart[] => list.map(item => item.type === type ? part(type, data, item.sub) : item)
const reseal = (bytes: Uint8Array): Uint8Array => { new DataView(bytes.buffer).setUint32(0, mapChecksum(bytes), true); return bytes }
function code(run: () => unknown): MapDecodeErrorCode | null {
  try { run() }
  catch (error) { if (error instanceof MapDecodeError) return error.code; throw error }
  return null
}

test('part encryption and checksum follow the hand-computed reference scheme', () => {
  expect([...cryptMapPart(Uint8Array.from([0, 0]), 2, 'encrypt')]).toEqual([2, 4])
  expect([...cryptMapPart(Uint8Array.from([2, 4]), 2, 'decrypt')]).toEqual([0, 0])
  expect(mapChecksum(Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 1, 0, 0, 0, 1, 0, 0, 0, 7]))).toBe(3)
  const bytes = encodeOriginalMap(11, parts()), view = new DataView(bytes.buffer)
  expect([bytes.length % 4, view.getUint32(4, true), view.getUint32(8, true), view.getUint32(12, true)]).toEqual([0, 11, 66, 12])
  expect([...bytes.subarray(16, 20)]).toEqual([...cryptMapPart(Uint8Array.from([1, 2, 3, 4]), 66, 'encrypt')])
})

test('a synthetic map round-trips geometry, entities, goods, players, teams and objectives', () => {
  const map = decodeOriginalMap(encodeOriginalMap(11, parts()))
  expect(map.format).toMatchObject({ version: 11, versionReferenceName: 'AMAZONS', checksum: { valid: true }, paddingBytes: 3 })
  expect(map.info).toEqual({ singlePlayer: true, playerCount: 2, startResources: 2 })
  expect(map.players).toEqual([
    { index: 0, civilization: 3, civilizationReferenceName: 'AMAZONS', startX: 1, startY: 2, name: 'Ana' },
    { index: 1, civilization: 255, civilizationReferenceName: 'FREE_CHOICE', startX: 3, startY: 3, name: '' },
  ])
  expect(map.teams).toEqual([{ sub: 0, name: 'Team', tail: [0, 1, 1, 2] }])
  expect(map.area.size).toBe(4)
  expect([...map.area.elevation]).toEqual(Array.from({ length: 16 }, (_, i) => i))
  expect([...map.area.landscape.subarray(0, 4)]).toEqual([0, 1, 2, 0])
  expect([...map.area.objects.subarray(0, 4)]).toEqual([68, 115, 9, 0])
  expect([map.area.owner[0], map.area.accessibility[0], map.area.resourceType[3], map.area.resourceAmount[3]]).toEqual([255, 1, 1, 5])
  expect([...map.preview!.pixels565]).toEqual([0xF800, 0x07E0, 0x001F, 0xFFFF])
  expect(map.settlers).toEqual([{ player: 0, type: 0, referenceName: 'BEARER', x: 1, y: 1 }])
  expect(map.buildings).toEqual([{ player: 1, type: 15, referenceName: 'TOWER', x: 2, y: 2, flags: 0, soldierNibbles: [1, 2, 3, 4, 5, 6, 7, 0, 8, 9], soldiers: { sword1: 1, sword2: 2, archer2: 3, archer3: 4, sword3: 5, archer1: 6, spear3: 7, spear1: 8, spear2: 9 } }])
  expect(map.stacks).toEqual([{ x: 0, y: 3, type: 1, referenceName: 'PLANK', amount: 8, trailer: 0 }])
  expect(map.victory!.killPlayers.players.slice(0, 3)).toEqual([false, true, false])
  expect(map.victory!.conquerPositions.positions[0]).toEqual({ enabled: true, x: 2, y: 3 })
  expect(map.victory!.produceGoods).toEqual({ enabled: true, goals: [{ amount: 50, good: 1 }, { amount: 0, good: 0 }, { amount: 0, good: 0 }] })
  expect([map.questText, map.questTip]).toEqual(['Win.', 'Tip'])
  expect(summarizeOriginalMap(map)).toMatchObject({ referenceTreeTiles: 1, referenceStoneTiles: 1, objectTiles: 3, resourceTiles: 1, settlers: 1, buildings: 1, stacks: 1 })
  expect(map.diagnostics.map(item => [item.code, item.partType])).toEqual([['unsupported-part', 66], ['unnamed-id', MAP_PART.area], ['uninterpreted-bytes', MAP_PART.teamInfo], ['interpretation', MAP_PART.victory]])
  expect(map.diagnostics[0]).toMatchObject({ offset: 8, length: 12 })
  expect(decodeOriginalMap(encodeOriginalMap(10, parts())).format.versionReferenceName).toBe('DEFAULT')
})

test('corrupt headers, checksums, part lengths and versions are rejected with typed codes', () => {
  const good = encodeOriginalMap(11, parts())
  expect(code(() => decodeOriginalMap(good.slice(0, 10)))).toBe('truncated')
  expect(code(() => decodeOriginalMap(reseal(good.slice(0, good.length - 8))))).toBe('truncated')
  expect(code(() => decodeOriginalMap(good, { maxBytes: 64 }))).toBe('file-too-large')
  expect(code(() => decodeOriginalMap(encodeOriginalMap(12, parts())))).toBe('unsupported-version')
  const flipped = good.slice()
  flipped[decodeOriginalMap(good).parts.at(-1)!.offset + 9]! ^= 1
  expect(code(() => decodeOriginalMap(flipped))).toBe('checksum-mismatch')
  expect(decodeOriginalMap(flipped, { requireValidChecksum: false }).diagnostics[0]!.code).toBe('checksum-mismatch')
  const long = good.slice(); new DataView(long.buffer).setUint32(12, good.length, true)
  expect(code(() => decodeOriginalMap(reseal(long)))).toBe('part-out-of-bounds')
  const short = good.slice(); new DataView(short.buffer).setUint32(12, 4, true)
  expect(code(() => decodeOriginalMap(reseal(short)))).toBe('invalid-part-length')
  expect(code(() => decodeOriginalMap(encodeOriginalMap(11, parts().filter(item => item.type !== MAP_PART.area))))).toBe('missing-part')
  expect(code(() => decodeOriginalMap(encodeOriginalMap(11, [...parts(), part(MAP_PART.settlers, words(4, 0))])))).toBe('duplicate-part')
  expect(code(() => decodeOriginalMap(encodeOriginalMap(11, parts()), { maxParts: 4 }))).toBe('too-many-parts')
})

test('allocation bombs and corrupt records fail before allocation or use', () => {
  const run = (type: number, data: number[]): MapDecodeErrorCode | null => code(() => decodeOriginalMap(encodeOriginalMap(11, replace(parts(), type, data))))
  expect(run(MAP_PART.area, words(4, 0xFFFFFFFF))).toBe('dimension-limit')
  expect(run(MAP_PART.area, words(4, 0))).toBe('dimension-limit')
  expect(run(MAP_PART.area, words(4, 1000))).toBe('invalid-record')
  expect(run(MAP_PART.preview, words(2, 0xFFFF, 0))).toBe('dimension-limit')
  expect(run(MAP_PART.settlers, words(4, 0xFFFFFFFF))).toBe('invalid-record')
  expect(run(MAP_PART.stacks, [...words(4, 1), ...words(2, 9, 0), 1, 1, 0, 0])).toBe('invalid-record')
  expect(run(MAP_PART.mapInfo, words(4, 1, 21, 0))).toBe('invalid-record')
  expect(run(MAP_PART.mapInfo, words(4, 2, 2, 0))).toBe('invalid-record')
  expect(run(MAP_PART.playerInfo, words(4, 3, 1, 2))).toBe('invalid-record')
  const badFlag = victory(); badFlag[21] = 7
  expect(run(MAP_PART.victory, badFlag)).toBe('invalid-record')
  expect(run(MAP_PART.victory, victory().slice(0, 100))).toBe('invalid-record')
})

const demoReason = 'requires the local Amazons demo archive at storage/reference/s3a_demo_us.exe'
test.skipIf(!existsSync(DEMO_ARCHIVE))(`original demo maps decode to recorded facts (${demoReason})`, async () => {
  const { archive, maps } = await loadDemoMaps()
  const inventory = await Bun.file(DEMO_INVENTORY).json() as { inspectedFiles: { path: string, sha256: string }[] }
  for (const map of maps) expect(sha256(map.bytes)).toBe(inventory.inspectedFiles.find(entry => entry.path === map.path)!.sha256)
  expect(maps.map(map => map.path)).toEqual(['Map/MULTI/Demo.map', 'Map/SINGLE/demo.map', 'Map/TUTORIAL/T1.MAP'])
  const [multi, single, tutorial] = maps.map(map => inspectDemoMap(map))
  expect(multi).toMatchObject({
    version: 10, versionReferenceName: 'DEFAULT', checksumValid: true, singlePlayer: false, startResources: 3, victory: null, parts: 15, unsupportedParts: 7,
    players: [[162, 125], [436, 171], [226, 474], [480, 498]].map(([startX, startY]) => ({ civilization: 255, startX, startY })),
    counts: { size: 640, tiles: 409600, players: 4, teamSets: 4, elevatedTiles: 192493, nonzeroLandscapeTiles: 402652, distinctLandscapeIds: 26, objectTiles: 6237, referenceTreeTiles: 2189, referenceStoneTiles: 771, referenceDecorationTiles: 475, resourceTiles: 31447, settlers: 0, buildings: 0, stacks: 0, questTextCharacters: 0, questTipCharacters: 0 },
  })
  expect(single).toMatchObject({
    version: 11, versionReferenceName: 'AMAZONS', checksumValid: true, singlePlayer: true, startResources: 2, parts: 18, unsupportedParts: 7,
    players: [{ civilization: 3, startX: 84, startY: 386 }, { civilization: 0, startX: 143, startY: 150 }],
    victory: { killPlayers: true, destroyBuildings: false, conquerPositions: false, survive: false, produceGoods: false },
    counts: { size: 448, tiles: 200704, players: 2, teamSets: 1, elevatedTiles: 91126, nonzeroLandscapeTiles: 195590, distinctLandscapeIds: 22, objectTiles: 1457, referenceTreeTiles: 449, referenceStoneTiles: 358, referenceDecorationTiles: 12, resourceTiles: 2430, settlers: 82, buildings: 28, stacks: 67, questTextCharacters: 303, questTipCharacters: 209 },
  })
  expect(tutorial).toMatchObject({
    version: 11, versionReferenceName: 'AMAZONS', checksumValid: true, singlePlayer: true, startResources: 2, parts: 15, unsupportedParts: 6,
    players: [{ civilization: 0, startX: 186, startY: 210 }, { civilization: 3, startX: 101, startY: 42 }],
    victory: { killPlayers: false, destroyBuildings: false, conquerPositions: false, survive: false, produceGoods: false },
    counts: { size: 256, tiles: 65536, players: 2, teamSets: 1, elevatedTiles: 31250, nonzeroLandscapeTiles: 60936, distinctLandscapeIds: 23, objectTiles: 504, referenceTreeTiles: 208, referenceStoneTiles: 114, referenceDecorationTiles: 24, resourceTiles: 1653, settlers: 54, buildings: 2, stacks: 31, questTextCharacters: 0, questTipCharacters: 0 },
  })
  const codes = (report: Record<string, unknown>): string[] => (report.diagnostics as { code: string }[]).map(item => item.code)
  expect(codes(multi!)).toEqual([...Array.from<string>({ length: 7 }).fill('unsupported-part'), 'unnamed-id', 'uninterpreted-bytes'])
  expect(codes(single!)).toEqual([...Array.from<string>({ length: 7 }).fill('unsupported-part'), 'unnamed-id', 'uninterpreted-bytes', 'uninterpreted-bytes', 'uninterpreted-bytes', 'interpretation'])
  expect(codes(tutorial!)).toEqual([...Array.from<string>({ length: 6 }).fill('unsupported-part'), 'unnamed-id', 'uninterpreted-bytes', 'uninterpreted-bytes', 'uninterpreted-bytes', 'uninterpreted-bytes', 'interpretation'])
  const receipt = resolve(import.meta.dir, '../../docs/content/map-decode-receipt.json')
  if (existsSync(receipt)) expect(await Bun.file(receipt).json()).toEqual(JSON.parse(JSON.stringify(mapReceipt(archive, maps))))
}, 60_000)
