export const editionIds = ['base', 'mission-cd', 'amazons', 'gold'] as const
export type EditionId = typeof editionIds[number]
export type ContentPack = 'base' | 'mission-cd' | 'amazons'

export interface FidelitySource {
  id: string
  kind: 'manual' | 'engineering-decision'
  revision: string
  path: string
  sha256: string
  url: string
}

export interface EditionProfile {
  id: EditionId
  label: string
  contentPacks: ContentPack[]
  revision: { status: 'unverified', missing: string[] }
}

export interface DocumentaryFeature {
  id: string
  summary: string
  evidence: { source: string, section: string }
  applicability: Record<EditionId, 'documented' | 'unverified' | 'product-target'>
}

export interface FidelityContract {
  schemaVersion: 1
  version: string
  sources: FidelitySource[]
  editions: EditionProfile[]
  features: DocumentaryFeature[]
  systems: { id: string, title: string, source: string, status: 'required' }[]
  targets: string[]
  originalObservations: never[]
}

export function validateFidelityContract(contract: FidelityContract): void {
  if (contract.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(contract.version))
    throw new Error('Unsupported fidelity contract version')
  const sources = new Map<string, FidelitySource>()
  for (const source of contract.sources) {
    if (sources.has(source.id)) throw new Error(`Duplicate source ${source.id}`)
    if (!/^[a-f0-9]{40}$/.test(source.revision) || !/^[a-f0-9]{64}$/.test(source.sha256))
      throw new Error(`Invalid source identity ${source.id}`)
    const url = new URL(source.url)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash
      || !url.pathname.endsWith(`/blob/${source.revision}/${source.path}`))
      throw new Error(`Source URL is not pinned: ${source.id}`)
    sources.set(source.id, source)
  }
  const features = new Set<string>()
  for (const feature of contract.features) {
    if (features.has(feature.id)) throw new Error(`Duplicate feature ${feature.id}`)
    features.add(feature.id)
    const source = sources.get(feature.evidence.source)
    if (!source) throw new Error(`Unknown evidence source ${feature.evidence.source}`)
    if (source.kind !== 'manual') throw new Error(`Documentary feature requires a manual source: ${feature.id}`)
    if (!feature.evidence.section.trim()) throw new Error(`Missing source section ${feature.id}`)
    for (const id of editionIds) {
      if (!['documented', 'unverified', 'product-target'].includes(feature.applicability[id]))
        throw new Error(`Missing or invalid applicability: ${feature.id}/${id}`)
    }
  }
  const editions = new Set<string>()
  for (const edition of contract.editions) {
    if (editions.has(edition.id)) throw new Error(`Duplicate edition ${edition.id}`)
    if (!editionIds.includes(edition.id)) throw new Error(`Unknown edition ${edition.id}`)
    if (edition.revision.status !== 'unverified' || !edition.revision.missing.length
      || edition.revision.missing.some(field => !field.trim()))
      throw new Error(`Unverified revision must name missing identity: ${edition.id}`)
    const content: Record<EditionId, ContentPack[]> = {
      base: ['base'], 'mission-cd': ['base', 'mission-cd'], amazons: ['base', 'amazons'], gold: ['base', 'mission-cd', 'amazons'],
    }
    if (edition.contentPacks.length !== content[edition.id].length
      || new Set(edition.contentPacks).size !== edition.contentPacks.length
      || !content[edition.id].every(pack => edition.contentPacks.includes(pack)))
      throw new Error(`Incorrect content target ${edition.id}`)
    editions.add(edition.id)
  }
  for (const id of editionIds) {
    if (!editions.has(id)) throw new Error(`Missing edition ${id}`)
  }
  const systems = new Set<string>()
  for (const system of contract.systems) {
    if (systems.has(system.id)) throw new Error(`Duplicate system ${system.id}`)
    if (sources.get(system.source)?.kind !== 'engineering-decision')
      throw new Error(`System scope requires an engineering decision: ${system.id}`)
    systems.add(system.id)
  }
  for (let i = 1; i <= 107; i++) {
    const id = `S3-${i.toString().padStart(3, '0')}`
    if (!systems.has(id)) throw new Error(`Missing system ${id}`)
  }
  if (systems.size !== 107) throw new Error('Unknown system outside the approved scope')
  if (contract.originalObservations.length) throw new Error('Schema 1 contains documentary evidence only')
  const targets = ['browser', 'macos', 'windows', 'linux', 'ios', 'android']
  if (contract.targets.length !== targets.length || !targets.every(target => contract.targets.includes(target)))
    throw new Error('Incorrect supported target inventory')
}

export function compareEditions(contract: FidelityContract, from: EditionId, to: EditionId) {
  validateFidelityContract(contract)
  if (!contract.editions.some(edition => edition.id === from) || !contract.editions.some(edition => edition.id === to))
    throw new Error('Unknown edition profile')
  return {
    from,
    to,
    documentedForTarget: contract.features
      .filter(feature => feature.applicability[to] === 'documented' && feature.applicability[from] !== 'documented')
      .map(feature => ({ id: feature.id, summary: feature.summary, from: feature.applicability[from], evidence: { ...feature.evidence } })),
    originalRevisionComparison: 'unverified' as const,
    verifiedRuntimeDifferences: [],
  }
}

export function fidelityReport(contract: FidelityContract) {
  validateFidelityContract(contract)
  return {
    schemaVersion: contract.schemaVersion,
    version: contract.version,
    claim: 'documentary-specification-only' as const,
    sources: structuredClone(contract.sources),
    scope: { systems: contract.systems.length, targets: [...contract.targets] },
    originalObservations: contract.originalObservations.length,
    editions: structuredClone(contract.editions),
    comparisons: [compareEditions(contract, 'base', 'mission-cd'), compareEditions(contract, 'base', 'amazons')],
  }
}
