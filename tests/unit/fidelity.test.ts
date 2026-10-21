import { describe, expect, test } from 'bun:test'
import { fidelityContract } from '../../docs/fidelity/catalog'
import { compareEditions, fidelityReport, validateFidelityContract } from '../../resources/game/fidelity'
import { verifyFidelitySources } from '../../scripts/fidelity'

describe('Gold Edition fidelity specification', () => {
  test('compares documentary expansion features without claiming absence in an unidentified base revision', () => {
    const comparison = compareEditions(fidelityContract, 'base', 'amazons')
    expect(comparison.documentedForTarget.map(feature => feature.id)).toContain('amazon-campaigns')
    expect(comparison.documentedForTarget.find(feature => feature.id === 'amazon-campaigns')?.from).toBe('unverified')
    expect(comparison.originalRevisionComparison).toBe('unverified')
    expect(comparison.verifiedRuntimeDifferences).toEqual([])
  })
  test('requires all four edition profiles and every approved system exactly once', () => {
    expect(() => validateFidelityContract(fidelityContract)).not.toThrow()
    const missing = structuredClone(fidelityContract)
    missing.editions.pop()
    expect(() => validateFidelityContract(missing)).toThrow('Missing edition gold')
    const duplicated = structuredClone(fidelityContract)
    duplicated.systems[106] = { ...duplicated.systems[0]! }
    expect(() => validateFidelityContract(duplicated)).toThrow('Duplicate system S3-001')
  })
  test('rejects unpinned sources and engineering decisions presented as original documentation', () => {
    const floating = structuredClone(fidelityContract)
    floating.sources[0]!.url = floating.sources[0]!.url.replace(floating.sources[0]!.revision, 'main')
    expect(() => validateFidelityContract(floating)).toThrow('Source URL is not pinned')
    const mislabeled = structuredClone(fidelityContract)
    mislabeled.features[0]!.evidence.source = 'approved-specification'
    expect(() => validateFidelityContract(mislabeled)).toThrow('Documentary feature requires a manual source')
    const missing = structuredClone(fidelityContract)
    missing.features[0]!.evidence.source = 'missing-source'
    expect(() => validateFidelityContract(missing)).toThrow('Unknown evidence source')
  })
  test('reports the required scope separately from original runtime and revision evidence', () => {
    const report = fidelityReport(fidelityContract)
    expect(report.scope.systems).toBe(107)
    expect(report.scope.targets).toEqual(['browser', 'macos', 'windows', 'linux', 'ios', 'android'])
    expect(report.originalObservations).toBe(0)
    expect(report.editions.every(edition => edition.revision.status === 'unverified')).toBe(true)
    expect(report.editions.find(edition => edition.id === 'gold')?.contentPacks).toEqual(['base', 'mission-cd', 'amazons'])
    expect(report.claim).toBe('documentary-specification-only')
  })
  test('refuses unsupported revision claims, partial Gold content and missing applicability', () => {
    const revision = structuredClone(fidelityContract)
    revision.editions[0]!.revision.missing = []
    expect(() => validateFidelityContract(revision)).toThrow('Unverified revision must name missing identity')
    const content = structuredClone(fidelityContract)
    content.editions[3]!.contentPacks = ['base']
    expect(() => validateFidelityContract(content)).toThrow('Incorrect content target gold')
    const applicability = structuredClone(fidelityContract)
    Reflect.deleteProperty(applicability.features[0]!.applicability, 'mission-cd')
    expect(() => validateFidelityContract(applicability)).toThrow('Missing or invalid applicability')
  })
  test('source verification rejects fetch failures, changed bytes and oversized evidence', async () => {
    await expect(verifyFidelitySources(fidelityContract, async () => new Response('not found', { status: 404 }))).rejects.toThrow('HTTP 404')
    await expect(verifyFidelitySources(fidelityContract, async () => new Response('changed source'))).rejects.toThrow('Source checksum mismatch')
    await expect(verifyFidelitySources(fidelityContract, async () => new Response(new Uint8Array(1_048_577)))).rejects.toThrow('1 MiB evidence bound')
  })
})
