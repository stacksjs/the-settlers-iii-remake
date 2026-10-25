import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tickets } from '../../docs/roadmap/catalog'
import { mergeGeneratedBody, nativeRelationship, validateCatalog, writeLocalDraft } from '../../scripts/roadmap'

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


test('local rendering preserves authored progress while updating a generated draft', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settlers-roadmap-draft-'))
  const path = join(dir, 'S3-071.md'), key = 'S3-071'
  const initial = '<!-- settlers-gold:S3-071 -->\n# Generated acceptance\nFirst criteria.\n'
  try {
    await Bun.write(path, `${initial}\n## Authored progress\nThe retained fixture resumed stone production.\n`)
    await writeLocalDraft(path, key, initial)
    const migrated = await Bun.file(path).text()
    expect(migrated).toContain('## Authored progress\nThe retained fixture resumed stone production.')
    expect(migrated).toContain('<!-- /settlers-gold:S3-071 -->')
    await writeLocalDraft(path, key, initial.replace('First criteria.', 'Updated criteria.'))
    const updated = await Bun.file(path).text()
    expect(updated).toContain('Updated criteria.')
    expect(updated).not.toContain('First criteria.')
    expect(updated).toContain('## Authored progress\nThe retained fixture resumed stone production.')
    await writeLocalDraft(path, key, initial.replace('First criteria.', 'Updated criteria.'))
    expect(await Bun.file(path).text()).toBe(updated)
  }
  finally { await rm(dir, { recursive: true, force: true }) }
})

test('local rendering refuses an unknown legacy boundary without modifying the draft', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settlers-roadmap-legacy-')), path = join(dir, 'draft.md')
  const existing = '<!-- settlers-gold:S3-071 -->\nEdited acceptance and human notes without a closing marker.\n'
  try {
    await Bun.write(path, existing)
    await expect(writeLocalDraft(path, 'S3-071', '<!-- settlers-gold:S3-071 -->\nDifferent criteria.')).rejects.toThrow('legacy draft')
    expect(await Bun.file(path).text()).toBe(existing)
  }
  finally { await rm(dir, { recursive: true, force: true }) }
})


test('the unmarked legacy index gains one bounded section and retains its authored notes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settlers-roadmap-index-')), path = join(dir, 'README.md')
  const body = '# Roadmap index\nGenerated graph.\n', generated = `<!-- settlers-gold:S3-INDEX -->\n${body}`
  try {
    await Bun.write(path, `${body}\n## Review notes\nThe browser milestone remains open.\n`)
    await writeLocalDraft(path, 'S3-INDEX', generated)
    const migrated = await Bun.file(path).text()
    expect(migrated.match(/<!-- settlers-gold:S3-INDEX -->/g)).toHaveLength(1)
    expect(migrated).toContain('<!-- /settlers-gold:S3-INDEX -->')
    expect(migrated).toContain('## Review notes\nThe browser milestone remains open.')
    await writeLocalDraft(path, 'S3-INDEX', generated)
    expect(await Bun.file(path).text()).toBe(migrated)
  }
  finally { await rm(dir, { recursive: true, force: true }) }
})
