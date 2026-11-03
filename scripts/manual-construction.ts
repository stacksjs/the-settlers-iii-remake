// Generates resources/game/engine/manual-construction.ts and
// docs/content/faction-construction-ledger.json.
//
// The pinned preserved manual (building.htm, "Table of Building Materials" and
// "Race Specific Buildings") lists the wood and stone every building costs for
// each of the four civilizations. That is manual evidence (class M). The ledger
// sets those figures beside the construction stacks the pinned reference remake
// defines, building by building, and records where the two sources disagree
// without choosing between them: choosing is the rules profile's job, and the
// original game's observation settles it (S3-007).
import { resolve } from 'node:path'
import process from 'node:process'

export const MANUAL_REVISION = '8426388935b436e65b0697ac401c4247ab097364'
export const MANUAL_FILE = 'en/ec_build/building.htm'
export const MANUAL_SHA256 = '10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e'
import { COMMON, RACES, SPECIFIC } from '../resources/game/engine/faction-names'
import type { Cost, Race } from '../resources/game/engine/faction-names'
export { COMMON, RACES, SPECIFIC }
export type { Cost, Race }

/** Engine building id to the reference definition file its geometry came from. */
export const referenceFilesFor = (geometry: Record<string, { file: string }>): Record<string, string> => Object.fromEntries(Object.entries(geometry).map(([id, entry]) => [id, entry.file]))

const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const rows = (html: string): string[][] => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1]!)))

export interface ManualCosts { common: Record<string, Record<Race, Cost>>, specific: Record<Race, Record<string, Cost>> }

/** Reads both cost tables out of the manual page; throws if the page no longer has the expected shape. */
export function parseManual(html: string): ManualCosts {
  // The page also names these headings in its contents list, so anchor on the table that follows them.
  const specificAt = html.search(/Race\s+Specific\s+Buildings/)
  const start = html.lastIndexOf('Table of Building Materials', specificAt)
  const proportionsAt = specificAt < 0 ? -1 : specificAt + Math.max(0, html.slice(specificAt).search(/General\s+Proportions\s+of/))
  if (specificAt < 0 || start < 0 || proportionsAt <= specificAt) throw new Error('The manual no longer has the expected cost tables')
  const common: ManualCosts['common'] = {}
  for (const row of rows(html.slice(start, specificAt))) {
    if (row.length !== 9 || !row.slice(1).every(cell => /^\d+$/.test(cell))) continue
    const n = row.slice(1).map(Number) as number[]
    common[row[0]!] = { roman: [n[0]!, n[1]!], egyptian: [n[2]!, n[3]!], asian: [n[4]!, n[5]!], amazon: [n[6]!, n[7]!] }
  }
  // The race-specific section pairs two civilizations per band, as (name, wood, stone) twice per row.
  const specific: ManualCosts['specific'] = { roman: {}, egyptian: {}, asian: {}, amazon: {} }
  let pair: [Race, Race] | null = null
  for (const row of rows(html.slice(specificAt, proportionsAt))) {
    const names = row.map(cell => cell.toLowerCase())
    if (names.includes('romans') && names.includes('egyptians')) { pair = ['roman', 'egyptian']; continue }
    if (names.includes('asians') && names.includes('amazons')) { pair = ['asian', 'amazon']; continue }
    if (!pair || row.length < 6) continue
    for (const [index, race] of pair.entries()) {
      const [name, wood, stone] = row.slice(index * 3, index * 3 + 3)
      if (name && /^\d+$/.test(wood ?? '') && /^\d+$/.test(stone ?? '')) specific[race][name] = [Number(wood), Number(stone)]
    }
  }
  return { common, specific }
}

export interface LedgerEntry { race: Race, reference: string, manualName: string | null, manual: Cost | null, referenceCost: Cost | null, agrees: boolean | null }

const costOf = (construction: { good: string, required: number }[]): Cost => [
  construction.filter(c => c.good === 'plank').reduce((sum, c) => sum + c.required, 0),
  construction.filter(c => c.good === 'stone').reduce((sum, c) => sum + c.required, 0),
]

/** Pairs every building either source names, per civilization. `agrees` is null where only one source has the building. */
export function ledger(manual: ManualCosts, referenceFactions: Record<string, Record<string, { construction: { good: string, required: number }[] }>>): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const race of RACES) {
    const files = referenceFactions[race]!
    const names = { ...COMMON, ...SPECIFIC[race] }
    const seen = new Set<string>()
    for (const file of Object.keys(files).sort()) {
      const manualName = names[file] ?? null
      const costs = manualName ? (COMMON[file] ? manual.common[manualName]?.[race] : manual.specific[race][manualName]) ?? null : null
      if (manualName) seen.add(manualName)
      const referenceCost = costOf(files[file]!.construction)
      entries.push({ race, reference: file, manualName, manual: costs, referenceCost, agrees: costs ? costs[0] === referenceCost[0] && costs[1] === referenceCost[1] : null })
    }
    // Buildings the manual prices that the reference does not define at all.
    const listed = [...Object.keys(manual.common).map(name => [name, manual.common[name]![race]] as const), ...Object.entries(manual.specific[race])]
    for (const [name, cost] of listed) if (!seen.has(name)) entries.push({ race, reference: '', manualName: name, manual: cost as Cost, referenceCost: null, agrees: null })
  }
  return entries
}

if (import.meta.main) {
  const response = await fetch(`https://raw.githubusercontent.com/JakeSteam/settlers/${MANUAL_REVISION}/${MANUAL_FILE}`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Manual unavailable (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  if (sha !== MANUAL_SHA256) throw new Error(`The manual page changed: ${sha}`)
  const manual = parseManual(new TextDecoder('latin1').decode(bytes))
  const { REFERENCE_FACTIONS } = await import('../resources/game/engine/reference-factions')
  const out = resolve(import.meta.dir, '../resources/game/engine/manual-construction.ts')
  await Bun.write(out, `// Generated by scripts/manual-construction.ts from the preserved manual ${MANUAL_FILE}
// at JakeSteam/settlers@${MANUAL_REVISION} (sha256 ${MANUAL_SHA256}).
// Manual evidence (class M): wood and stone each building costs, per civilization. Do not edit by hand.
export const MANUAL_CONSTRUCTION = ${JSON.stringify(manual)} as const
`)
  await Bun.write(resolve(import.meta.dir, '../docs/content/faction-construction-ledger.json'), `${JSON.stringify(ledger(manual, REFERENCE_FACTIONS as never), null, 2)}\n`)
  const lint = Bun.spawnSync([process.execPath, 'x', '--bun', 'pickier', 'lint', '--fix', out], { stdout: 'inherit', stderr: 'inherit' })
  const entries = ledger(manual, REFERENCE_FACTIONS as never)
  console.log(`Ledger: ${entries.length} entries, ${entries.filter(e => e.agrees === true).length} agree, ${entries.filter(e => e.agrees === false).length} disagree, ${entries.filter(e => e.agrees === null).length} named by one source only${lint.exitCode === 0 ? '' : ' (format check reported problems)'}.`)
}
