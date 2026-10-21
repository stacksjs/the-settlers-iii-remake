import { expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface Issue { id: number, number: number, html_url: string, title: string, body: string, labels: { name: string }[], milestone: { number: number, title: string } | null }
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
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 180_000)
