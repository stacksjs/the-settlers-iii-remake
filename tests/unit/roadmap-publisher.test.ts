import { expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface Issue { id: number, number: number, html_url: string, title: string, body: string, state: string, state_reason?: string | null, labels: { name: string }[], milestone: { number: number, title: string } | null }
interface Remote { repositories: Record<string, { issues: Issue[] }>, parents: Record<string, number>, blockers: Record<string, number[]> }
interface RegistryEntry { id: number, url: string, reused?: boolean, nativeParent?: boolean, nativeBlockers?: string[], relationshipLimits?: string[] }
interface Registry { master: RegistryEntry, epics: Record<string, RegistryEntry>, tickets: Record<string, RegistryEntry> }

test('roadmap publisher recovers a lost create response, preserves adopted work, and reconciles idempotently', async () => {
  const root = resolve(import.meta.dir, '../..')
  const directory = mkdtempSync(join(tmpdir(), 'settlers-roadmap-publisher-'))
  const statePath = join(directory, 'remote.json')
  const game = 'stacksjs/the-settlers-iii-remake'
  const stacks = 'stacksjs/stacks'
  const originalTitle = 'Existing desktop distribution work'
  const originalBody = 'Authored acceptance and signing notes. Preserve these.'
  try {
    for (const subdirectory of ['scripts', 'docs/roadmap', 'bin']) mkdirSync(join(directory, subdirectory), { recursive: true })
    for (const relative of ['scripts/roadmap.ts', 'docs/roadmap/catalog.ts', 'docs/roadmap/campaigns.ts']) copyFileSync(join(root, relative), join(directory, relative))
    const gh = join(directory, 'bin/gh')
    writeFileSync(gh, `#!${process.execPath}\n${readFileSync(join(root, 'tests/fixtures/roadmap/gh.ts'), 'utf8')}`)
    chmodSync(gh, 0o700)
    writeFileSync(statePath, JSON.stringify({
      nextId: 10000, interrupted: false,
      repositories: {
        [stacks]: {
          labels: [{ name: 'owner:desktop' }], milestones: [{ number: 73, title: 'Existing delivery milestone' }],
          issues: [
            { id: 50, number: 2058, html_url: `https://github.com/${stacks}/issues/2058`, title: 'Existing parent', body: 'Unrelated parent work', state: 'open', labels: [], milestone: null },
            { id: 51, number: 2059, html_url: `https://github.com/${stacks}/issues/2059`, title: originalTitle, body: originalBody, state: 'open', labels: [{ name: 'owner:desktop' }], milestone: { number: 73, title: 'Existing delivery milestone' } },
          ],
        },
      },
      parents: { 51: 50 }, blockers: {},
    }))
    const remote = (): Remote => JSON.parse(readFileSync(statePath, 'utf8')) as Remote
    const registry = (): Registry => JSON.parse(readFileSync(join(directory, 'docs/roadmap/github.json'), 'utf8')) as Registry
    async function run(mode: '--publish' | '--verify'): Promise<{ code: number, output: string }> {
      const child = Bun.spawn([process.execPath, '--no-env-file', join(directory, 'scripts/roadmap.ts'), mode], {
        cwd: directory,
        // Only the fixture executable is reachable. No installed gh or real token is inherited.
        env: { PATH: join(directory, 'bin'), ROADMAP_FAKE_STATE: statePath },
        stdout: 'pipe', stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, output: `${stdout}\n${stderr}` }
    }
    const first = await run('--publish')
    expect(first.code).not.toBe(0)
    expect(first.output).toContain('Fixture lost the create response')
    expect(registry().tickets['S3-025']).toBeUndefined()
    expect(remote().repositories[game]!.issues.filter(issue => issue.body.includes('<!-- settlers-gold:S3-025 -->'))).toHaveLength(1)

    const resumed = await run('--publish')
    expect(resumed.code, resumed.output).toBe(0)
    const published = registry()
    const entries = [published.master, ...Object.values(published.epics), ...Object.values(published.tickets)]
    expect(entries).toHaveLength(120)
    expect(new Set(entries.map(item => item.id)).size).toBe(120)
    const allIssues = Object.values(remote().repositories).flatMap(repository => repository.issues)
    expect(allIssues.filter(issue => issue.body.includes('<!-- settlers-gold:'))).toHaveLength(120)
    expect(allIssues).toHaveLength(121)
    const adopted = remote().repositories[stacks]!.issues.find(issue => issue.number === 2059)!
    expect(adopted.title).toBe(originalTitle)
    expect(adopted.body).toStartWith(originalBody)
    expect(adopted.labels).toContainEqual({ name: 'owner:desktop' })
    expect(adopted.milestone).toEqual({ number: 73, title: 'Existing delivery milestone' })
    expect(remote().parents[51]).toBe(50)
    expect(published.tickets['S3-101']!.reused).toBe(true)
    expect(published.tickets['S3-101']!.relationshipLimits?.join('\n')).toContain('Preserved existing parent')
    expect(published.tickets['S3-009']!.nativeParent).toBe(false)
    expect(published.tickets['S3-009']!.relationshipLimits?.join('\n')).toContain('Fixture denies native child listing')
    expect(published.tickets['S3-010']!.relationshipLimits?.join('\n')).toContain('Fixture denies dependency listing')
    const spriteIssue = allIssues.find(issue => issue.id === published.tickets['S3-010']!.id)!
    expect(spriteIssue.body).toContain(published.tickets['S3-009']!.url)
    const homeIssue = allIssues.find(issue => issue.id === published.tickets['S3-024']!.id)!
    expect(homeIssue.labels.map(label => label.name).filter(name => name.startsWith('platform:'))).toEqual(['platform:homeos'])

    const withHumanFollowUp = remote()
    withHumanFollowUp.repositories[stacks]!.issues.find(issue => issue.number === 2059)!.body += '\nHuman follow-up after the managed section.\n'
    writeFileSync(statePath, JSON.stringify(withHumanFollowUp))
    const beforeRepeat = readFileSync(statePath, 'utf8')
    const repeated = await run('--publish')
    expect(repeated.code, repeated.output).toBe(0)
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual(JSON.parse(beforeRepeat))
    expect(registry()).toEqual(published)
    const verified = await run('--verify')
    expect(verified.code, verified.output).toBe(0)
    expect(verified.output).toContain('Verified 120 tracking entries')

    const afterAudit = remote()
    const audit = afterAudit.repositories[game]!.issues.find(issue => issue.id === published.tickets['S3-008']!.id)!
    expect(audit.labels).toContainEqual({ name: 'ready-for-agent' })
    // GitHub closing an issue preserves its labels. Only remote state changes here.
    audit.state = 'closed'
    audit.state_reason = 'completed'
    writeFileSync(statePath, JSON.stringify(afterAudit))
    const staleFrontier = await run('--verify')
    expect(staleFrontier.code).not.toBe(0)
    expect(staleFrontier.output).toContain('Incorrect frontier label: S3-008')

    const reconciled = await run('--publish')
    expect(reconciled.code, reconciled.output).toBe(0)
    const current = registry()
    const currentEntries = [current.master, ...Object.values(current.epics), ...Object.values(current.tickets)]
    expect(currentEntries.map(item => [item.id, item.url])).toEqual(entries.map(item => [item.id, item.url]))
    const currentIssues = Object.values(remote().repositories).flatMap(repository => repository.issues)
    expect(currentIssues.filter(issue => issue.body.includes('<!-- settlers-gold:'))).toHaveLength(120)
    expect(currentIssues).toHaveLength(121)
    const closedAudit = currentIssues.find(issue => issue.id === audit.id)!
    expect(closedAudit.state).toBe('closed')
    expect(closedAudit.labels).not.toContainEqual({ name: 'ready-for-agent' })
    for (const key of ['S3-009', 'S3-021']) {
      const unblocked = currentIssues.find(issue => issue.id === current.tickets[key]!.id)!
      expect(unblocked.state).toBe('open')
      expect(unblocked.labels).toContainEqual({ name: 'ready-for-agent' })
    }
    const foundations = currentIssues.find(issue => issue.id === current.epics['2']!.id)!
    expect(foundations.body).toContain(`- [x] ${published.tickets['S3-008']!.url} - Audit Craft, stx, and HomeOS execution evidence`)
    const verifiedFrontier = await run('--verify')
    expect(verifiedFrontier.code, verifiedFrontier.output).toBe(0)
    expect(verifiedFrontier.output).toContain('Verified 120 tracking entries')

    const afterCancellation = remote()
    const cancelled = Object.values(afterCancellation.repositories).flatMap(repository => repository.issues).find(issue => issue.id === current.tickets['S3-009']!.id)!
    expect(cancelled.labels).toContainEqual({ name: 'ready-for-agent' })
    cancelled.state = 'closed'
    cancelled.state_reason = 'not_planned'
    writeFileSync(statePath, JSON.stringify(afterCancellation))
    const reconciledCancellation = await run('--publish')
    expect(reconciledCancellation.code, reconciledCancellation.output).toBe(0)
    const afterCancelledRegistry = registry()
    const afterCancelledEntries = [afterCancelledRegistry.master, ...Object.values(afterCancelledRegistry.epics), ...Object.values(afterCancelledRegistry.tickets)]
    expect(afterCancelledEntries.map(item => [item.id, item.url])).toEqual(entries.map(item => [item.id, item.url]))
    const afterCancelledIssues = Object.values(remote().repositories).flatMap(repository => repository.issues)
    expect(afterCancelledIssues.filter(issue => issue.body.includes('<!-- settlers-gold:'))).toHaveLength(120)
    expect(afterCancelledIssues).toHaveLength(121)
    const cancelledGraphics = afterCancelledIssues.find(issue => issue.id === cancelled.id)!
    expect(cancelledGraphics.state).toBe('closed')
    expect(cancelledGraphics.state_reason).toBe('not_planned')
    expect(cancelledGraphics.labels).not.toContainEqual({ name: 'ready-for-agent' })
    const blockedSprites = afterCancelledIssues.find(issue => issue.id === current.tickets['S3-010']!.id)!
    expect(blockedSprites.state).toBe('open')
    expect(blockedSprites.labels).not.toContainEqual({ name: 'ready-for-agent' })
    const cancelledFoundations = afterCancelledIssues.find(issue => issue.id === current.epics['2']!.id)!
    expect(cancelledFoundations.body).toContain(`- [ ] ${current.tickets['S3-009']!.url} - Establish an executable graphics core and truthful capabilities`)
    const verifiedCancellation = await run('--verify')
    expect(verifiedCancellation.code, verifiedCancellation.output).toBe(0)
    expect(verifiedCancellation.output).toContain('Verified 120 tracking entries')

    // An interrupted listing that omits recorded issues must not recreate the graph.
    const truncated = remote() as Remote & { truncatedListings?: string[] }
    truncated.truncatedListings = [game]
    writeFileSync(statePath, JSON.stringify(truncated))
    const beforeTruncated = Object.values(remote().repositories).flatMap(repository => repository.issues).length
    const refused = await run('--publish')
    expect(refused.code).not.toBe(0)
    expect(refused.output).toContain('is incomplete')
    expect(Object.values(remote().repositories).flatMap(repository => repository.issues)).toHaveLength(beforeTruncated)
    expect(registry()).toEqual(afterCancelledRegistry)

    // A newer stray issue carrying a tracked marker is never adopted over the recorded issue.
    const strayed = remote() as Remote & { truncatedListings?: string[] }
    strayed.truncatedListings = []
    const recordedAudit = strayed.repositories[game]!.issues.find(issue => issue.id === current.tickets['S3-025']!.id)!
    strayed.repositories[game]!.issues.push({ ...recordedAudit, id: 99_999, number: 999, html_url: `https://github.com/${game}/issues/999`, labels: [] })
    writeFileSync(statePath, JSON.stringify(strayed))
    const kept = await run('--publish')
    expect(kept.code, kept.output).toBe(0)
    expect(registry().tickets['S3-025']!.id).toBe(current.tickets['S3-025']!.id)
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 180_000)
