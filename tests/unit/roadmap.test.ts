import { describe, expect, test } from 'bun:test'
import { tickets } from '../../docs/roadmap/catalog'
import { mergeGeneratedBody, nativeRelationship, validateCatalog } from '../../scripts/roadmap'

describe('Gold Edition issue graph', () => {
  test('contains exactly the approved unique implementation slots with a valid acyclic graph', () => {
    expect(() => validateCatalog()).not.toThrow()
    expect(new Set(tickets.map(ticket => ticket.key)).size).toBe(107)
    expect(new Set(tickets.map(ticket => ticket.epic)).size).toBe(12)
  })
  test('rejects missing blockers and dependency cycles before any remote mutation', () => {
    const missing = structuredClone(tickets)
    missing[0]!.blockers = ['S3-999']
    expect(() => validateCatalog(missing)).toThrow('Unknown blocker')
    const cyclic = structuredClone(tickets)
    cyclic[0]!.blockers = ['S3-002']
    expect(() => validateCatalog(cyclic)).toThrow('Dependency cycle')
  })
  test('HomeOS graphical integration is not a blocker for game release', () => {
    expect(tickets.flatMap(ticket => ticket.blockers)).not.toContain('S3-024')
    expect(tickets.find(ticket => ticket.key === 'S3-107')!.repository).toBe('stacksjs/the-settlers-iii-remake')
  })
  test('rejects renamed slots outside the approved identifier set', () => {
    const renamed = structuredClone(tickets)
    renamed[106]!.key = 'S3-108'
    expect(() => validateCatalog(renamed)).toThrow('Missing approved identifier S3-107')
  })
  test('retains restricted relationship diagnostics but propagates transport failures', async () => {
    const reasons: string[] = []
    for (const status of [403, 404, 422]) {
      const result = await nativeRelationship(async () => { throw new Error(`GitHub command failed: HTTP ${status}`) }, reason => reasons.push(reason))
      expect(result).toBeUndefined()
    }
    expect(reasons).toHaveLength(3)
    expect(await nativeRelationship(async () => ['linked'], reason => reasons.push(reason))).toEqual(['linked'])
    await expect(nativeRelationship(async () => { throw new Error('HTTP 503') }, reason => reasons.push(reason))).rejects.toThrow('HTTP 503')
    expect(reasons).toHaveLength(3)
  })
  test('publishing replaces only its generated section and preserves authored text', () => {
    const initial = mergeGeneratedBody('Original source issue', 'S3-101', '<!-- settlers-gold:S3-101 -->\nFirst version')
    const updated = mergeGeneratedBody(`${initial}\nHuman follow-up`, 'S3-101', '<!-- settlers-gold:S3-101 -->\nSecond version')
    expect(updated).toContain('Original source issue')
    expect(updated).toContain('Human follow-up')
    expect(updated).toContain('Second version')
    expect(updated).not.toContain('First version')
    expect(() => mergeGeneratedBody('<!-- settlers-gold:S3-101 -->\nUnterminated', 'S3-101', 'New')).toThrow('unterminated')
  })
})
