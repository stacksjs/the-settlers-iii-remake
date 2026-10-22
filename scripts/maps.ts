import { resolve } from 'node:path'
import { decodeOriginalMap, MAP_REFERENCE, summarizeOriginalMap } from './lib/s3-map'

const root = resolve(import.meta.dir, '..')
export const DEMO_ARCHIVE = resolve(root, 'storage/reference/s3a_demo_us.exe')
export const DEMO_INVENTORY = resolve(root, 'docs/fidelity/amazons-demo-inventory.json')
const RECEIPT = resolve(root, 'docs/content/map-decode-receipt.json')

interface InventoryFile { path: string, bytes: number, sha256: string }
export interface DemoMap { path: string, bytes: Uint8Array, sha256: string }
export const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

export async function loadDemoMaps(archive = DEMO_ARCHIVE): Promise<{ archive: InventoryFile, maps: DemoMap[] }> {
  const inventory = await Bun.file(DEMO_INVENTORY).json() as { archive: InventoryFile, inspectedFiles: InventoryFile[] }
  const file = Bun.file(archive)
  if (!await file.exists()) throw new Error(`Demo archive not found at ${archive}`)
  if (file.size !== inventory.archive.bytes) throw new Error(`Demo archive has ${file.size} bytes, expected ${inventory.archive.bytes}`)
  const archiveHash = sha256(new Uint8Array(await file.arrayBuffer()))
  if (archiveHash !== inventory.archive.sha256) throw new Error(`Demo archive SHA-256 ${archiveHash} does not match the inventory ${inventory.archive.sha256}`)
  const maps = inventory.inspectedFiles.filter(entry => /\.map$/i.test(entry.path)).map((entry) => {
    const run = Bun.spawnSync({ cmd: ['unzip', '-p', archive, entry.path], stdout: 'pipe', stderr: 'pipe' })
    if (run.exitCode !== 0) throw new Error(`unzip could not extract ${entry.path}: ${run.stderr.toString().trim()}`)
    const bytes = new Uint8Array(run.stdout), hash = sha256(bytes)
    if (bytes.length !== entry.bytes || hash !== entry.sha256) throw new Error(`${entry.path} does not match the inventory (${bytes.length} bytes, SHA-256 ${hash})`)
    return { path: entry.path, bytes, sha256: hash }
  })
  return { archive: { path: inventory.archive.path, bytes: inventory.archive.bytes, sha256: archiveHash }, maps }
}

export function inspectDemoMap(map: DemoMap): Record<string, unknown> {
  const decoded = decodeOriginalMap(map.bytes)
  return {
    path: map.path,
    bytes: map.bytes.length,
    sha256: map.sha256,
    version: decoded.format.version,
    versionReferenceName: decoded.format.versionReferenceName,
    checksumValid: decoded.format.checksum.valid,
    singlePlayer: decoded.info.singlePlayer,
    startResources: decoded.info.startResources,
    players: decoded.players.map(player => ({ civilization: player.civilization, civilizationReferenceName: player.civilizationReferenceName, startX: player.startX, startY: player.startY })),
    victory: decoded.victory && Object.fromEntries(Object.entries(decoded.victory).map(([name, value]) => [name, value.enabled])),
    parts: decoded.parts.length,
    unsupportedParts: decoded.parts.filter(part => !part.decoded).length,
    counts: summarizeOriginalMap(decoded),
    diagnostics: decoded.diagnostics,
  }
}

export function mapReceipt(archive: InventoryFile, maps: DemoMap[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    evidenceClass: 'unexecuted-binary-decode',
    executed: false,
    originalBehaviorAdmitted: false,
    decoder: { module: 'scripts/lib/s3-map.ts', adaptedFrom: MAP_REFERENCE },
    archive: { path: archive.path, bytes: archive.bytes, sha256: archive.sha256 },
    maps: maps.map((map) => {
      const decoded = decodeOriginalMap(map.bytes)
      return {
        path: map.path,
        bytes: map.bytes.length,
        sha256: map.sha256,
        version: decoded.format.version,
        versionReferenceName: decoded.format.versionReferenceName,
        checksumValid: decoded.format.checksum.valid,
        width: decoded.area.size,
        height: decoded.area.size,
        parts: decoded.parts.length,
        unsupportedParts: decoded.parts.filter(part => !part.decoded).length,
        counts: summarizeOriginalMap(decoded),
        diagnostics: decoded.diagnostics,
      }
    }),
    limits: [
      'Decoded from original map bytes without running the original game; no runtime behavior is admitted.',
      'Version and type names are reference-remake labels, not original identifiers.',
      'Tree, stone and decoration counts use the reference remake object classes.',
      'Mission objective semantics, team set bytes and unsupported part types remain unverified.',
      'The file checksum matches all three maps, but its OR step can absorb a changed bit, so it is not a full integrity check; SHA-256 identity is.',
    ],
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    if (!args.includes('--inventory') || args.some(arg => !['--inventory', '--json', '--receipt'].includes(arg))) throw new Error('Usage: bun scripts/maps.ts --inventory [--json] [--receipt]')
    const { archive, maps } = await loadDemoMaps()
    const reports = maps.map(inspectDemoMap)
    if (args.includes('--json')) console.log(JSON.stringify({ schemaVersion: 1, archive, maps: reports }, null, 2))
    else {
      console.log(`Demo archive verified: ${archive.sha256}`)
      for (const report of reports) {
        const counts = report.counts as Record<string, number>, players = report.players as { civilization: number, startX: number, startY: number }[]
        console.log(`${report.path}: version ${report.version} (${report.versionReferenceName}, reference label), ${counts.size}x${counts.size}, checksum ${report.checksumValid ? 'valid' : 'invalid'}, ${report.singlePlayer ? 'single player' : 'multiplayer'}`)
        console.log(`  players ${players.map(player => `civ ${player.civilization} at ${player.startX},${player.startY}`).join('; ')}`)
        console.log(`  settlers ${counts.settlers}, buildings ${counts.buildings}, stacks ${counts.stacks}, object tiles ${counts.objectTiles}, resource tiles ${counts.resourceTiles}, team sets ${counts.teamSets}`)
        console.log(`  ${(report.diagnostics as unknown[]).length} diagnostics, ${report.unsupportedParts} of ${report.parts} parts not decoded`)
      }
    }
    if (args.includes('--receipt')) {
      await Bun.write(RECEIPT, `${JSON.stringify(mapReceipt(archive, maps), null, 2)}\n`)
      console.error(`Wrote ${RECEIPT}`)
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
