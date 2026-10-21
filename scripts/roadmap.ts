import type { Ticket } from '../docs/roadmap/catalog'
import { mkdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { campaignAcceptanceTable } from '../docs/roadmap/campaigns'
import { epics, gameRepository, relatedIssues, reuseIssues, tickets } from '../docs/roadmap/catalog'

interface RemoteIssue { id: number, number: number, html_url: string, state: string, state_reason?: string | null, title: string, body: string | null, labels: { name: string }[], milestone: { number: number, title: string } | null, pull_request?: unknown }
interface Entry { repository: string, number: number, id: number, url: string, state: string, stateReason?: string | null, title: string, labels: string[], milestone: number | null, reused?: boolean, nativeParent?: boolean, nativeBlockers?: string[], relationshipLimits?: string[] }
interface Registry { version: 1, master?: Entry, epics: Record<string, Entry>, tickets: Record<string, Entry> }
const root = resolve(import.meta.dir, '..')
const registryPath = resolve(root, 'docs/roadmap/github.json')
const marker = (key: string): string => `<!-- settlers-gold:${key} -->`
const endMarker = (key: string): string => `<!-- /settlers-gold:${key} -->`

export function mergeGeneratedBody(existing: string, key: string, generated: string): string {
  const start = existing.indexOf(marker(key))
  const block = `${generated.trimEnd()}\n${endMarker(key)}\n`
  if (start < 0) return existing ? `${existing.trimEnd()}\n\n${block}` : block
  const end = existing.indexOf(endMarker(key), start)
  if (end < 0) throw new Error(`Cannot safely replace unterminated generated section: ${key}`)
  return `${existing.slice(0, start)}${block}${existing.slice(end + endMarker(key).length).replace(/^\n/, '')}`
}

export function validateCatalog(items: Ticket[] = tickets): void {
  if (items.length !== 107 || epics.length !== 12) throw new Error('Expected 107 implementation issues and 12 epics')
  const byKey = new Map(items.map(ticket => [ticket.key, ticket]))
  if (byKey.size !== items.length) throw new Error('Duplicate stable identifier')
  for (let number = 1; number <= 107; number++) {
    const key = `S3-${number.toString().padStart(3, '0')}`
    if (!byKey.has(key)) throw new Error(`Missing approved identifier ${key}`)
  }
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Dependency cycle at ${key}`)
    if (visited.has(key)) return
    const ticket = byKey.get(key)
    if (!ticket) throw new Error(`Unknown blocker ${key}`)
    if (!ticket.criteria.length || ticket.tests.length < 2 || !epics[ticket.epic - 1]) throw new Error(`Incomplete ticket ${key}`)
    if (/[\u2013\u2014]/.test(ticket.title + ticket.criteria.join(''))) throw new Error(`Nonstandard separator in ${key}`)
    visiting.add(key)
    for (const blocker of ticket.blockers) visit(blocker)
    visiting.delete(key); visited.add(key)
  }
  for (const ticket of items) visit(ticket.key)
}

async function command(args: string[], input?: unknown): Promise<string> {
  const child = Bun.spawn(['gh', ...args], { cwd: root, stdin: input === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' })
  if (input !== undefined) {
    if (!child.stdin) throw new Error('GitHub input pipe was not opened')
    child.stdin.write(JSON.stringify(input)); child.stdin.end()
  }
  const [status, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (status) throw new Error(`GitHub command failed (${status}): ${errors.slice(-1500)}`)
  return output
}

async function api<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  const args = ['api', '--method', method, path]
  if (input !== undefined) args.push('--input', '-')
  const output = await command(args, input)
  return (output.trim() ? JSON.parse(output) : null) as T
}

async function readRegistry(): Promise<Registry> {
  return await Bun.file(registryPath).exists() ? await Bun.file(registryPath).json() as Registry : { version: 1, epics: {}, tickets: {} }
}
async function persist(registry: Registry): Promise<void> {
  const temporary = `${registryPath}.pending`
  await Bun.write(temporary, `${JSON.stringify(registry, null, 2)}\n`)
  await rename(temporary, registryPath)
}
function entry(repository: string, issue: RemoteIssue, reused = false): Entry {
  return { repository, id: issue.id, number: issue.number, url: issue.html_url, state: issue.state, stateReason: issue.state_reason ?? null, title: issue.title, labels: issue.labels.map(label => label.name), milestone: issue.milestone?.number ?? null, ...(reused ? { reused: true } : {}) }
}

function completed(item: Entry | undefined): boolean { return item?.state === 'closed' && item.stateReason === 'completed' }

function bodyFor(ticket: Ticket, registry: Registry): string {
  const epic = epics[ticket.epic - 1]!, parent = registry.epics[String(ticket.epic)]
  const blockers = ticket.blockers.map(key => `- ${registry.tickets[key]?.url ?? key}`).join('\n') || 'None. This issue is on the initial frontier.'
  const source = ticket.repository !== gameRepository
  const campaign = ticket.key.match(/^S3-0(76|77|78|79|80|82)$/)
  return `${marker(ticket.key)}
# ${ticket.key}: ${ticket.title}

## Parent and ownership

Parent epic: ${parent?.url ?? `S3-E${ticket.epic.toString().padStart(2, '0')}`}
Source owner: \`${ticket.repository}\`. Master roadmap: ${registry.master?.url ?? 'S3-MASTER'}.

## Problem and observable result

${ticket.criteria.map(text => `${text}.`).join(' ')}

The current application is a browser prototype. Passing the Riverlands campaign does not establish original-game or native parity. This issue is complete only when its stated behavior has retained evidence.

## Evidence and interfaces

${epic.seam}

${epic.sources.map(url => `- ${url}`).join('\n')}
${(relatedIssues[ticket.key] ?? []).map(url => `- Related existing work: ${url}`).join('\n')}

Pin the inspected revisions and fixture hashes in the implementation evidence. Original-game observations govern rules and timing. JSettlers is implementation evidence, not an authoritative balance specification. Unknown values remain explicitly unverified.

## Acceptance criteria

${ticket.criteria.map(text => `- [ ] ${text}.`).join('\n')}
- [ ] The visible result agrees with the underlying simulation or platform state, including failure paths.
- [ ] Tests exercise the maintained public interface and retain reproducible fixtures or execution receipts.
${campaign ? '- [ ] Include a per-mission table covering original identifier, starting state, objectives, special triggers, save/load, failure, victory, and retained evidence. A generic victory is insufficient.\n' : ''}

## Test matrix

${ticket.tests.map(text => `- ${text}.`).join('\n')}
- Exercise invalid input, cancellation or interruption, and repeated execution where this interface permits them.
- Verify determinism/conservation for simulation changes and resource ownership/disposal for platform changes.
- Run owning-repository lint, relevant type checks and tests. Capture actual native output for native capability claims.

## Scope constraints

Implement this behavior as a complete verifiable slice. Do not silently expand into adjacent tickets or substitute simplified gameplay. Keep the shared TypeScript simulation, shared stx signals, and ts-css conventions. Native gameplay and HUD must not depend on a WebView. HomeOS reuse must not introduce a kernel dependency into the game. Existing unrelated edits and authored guidance must be preserved.

${campaignAcceptanceTable(ticket.key)}
## Blocked by

${blockers}

## Upstream release and adoption

${source ? 'Fix and test the owning source repository, run its existing `bun run release:patch` when it is a Bun package repository, verify published artifacts, then install into Stacks and release Stacks when affected. Update the game from verified published packages. HomeOS uses its own build/source provenance.' : 'Application behavior belongs here. If a reproduction identifies a framework defect, repair and release its owning source first, update Stacks where affected, then install the verified packages here.'}

No node_modules edits, copied runtimes, generated-source string patches, fabricated globals, successful no-op implementations, or skipped release gates. Push tested conventional commits as Chris to the owning origin/main without coauthor trailers or force pushes.

## Completion evidence

- Implementation commits and relevant upstream issue links.
- Exact checks and results, fixture hashes, and screenshots/native execution evidence where applicable.
- Published package versions, downstream lockfile identity, and release receipts when affected.
- Remaining limitations stated explicitly. Partial work does not close this issue.
`
}

function epicBody(index: number, registry: Registry): string {
  const epic = epics[index - 1]!, children = tickets.filter(ticket => ticket.epic === index)
  const rows = children.map(ticket => `- [${completed(registry.tickets[ticket.key]) ? 'x' : ' '}] ${registry.tickets[ticket.key]?.url ?? ticket.key} - ${ticket.title}`).join('\n')
  return `${marker(`S3-E${index.toString().padStart(2, '0')}`)}
# ${epic.title}

Master: ${registry.master?.url ?? 'S3-MASTER'}

${epic.seam}

## Completion gate

All mandatory child acceptance criteria require verified implementation evidence. Research, compilation, prototype victory, and uploaded but unprocessed binaries are not equivalent to completion. HomeOS integration is independent of supported game platform delivery.

## Implementation issues

${rows}

## Dependencies

Work the actual child blocking graph. Do not make this entire epic a blocker for independent work. Sources and exact acceptance criteria are recorded in each child.
`
}

function masterBody(registry: Registry): string {
  return `${marker('S3-MASTER')}\n# Finish The Settlers III Remake: Gold Edition\n\nImplement faithful Gold Edition behavior through the original base game, Mission CD, and Amazons. Deliver browser plus true native macOS, Windows, Linux, iOS, and Android applications; original campaigns and presentation; authoritative cross-platform multiplayer; and reusable Stacks signing/store automation. Releases are free, without ads or in-app purchases. Bundled original content requires recorded redistribution evidence.\n\n## Architecture\n\nOne deterministic TypeScript simulation, physical people/goods/logistics, shared stx controls, ts-css styles, and Craft-owned native render surfaces. Metal on Apple targets, Vulkan on other native targets. Native gameplay and HUD do not require a WebView. Browser and native rendering share scene decisions. Online servers validate commands and filter hidden state. Versioned complete saves and deterministic replays preserve compatibility explicitly. HomeOS reuse follows executed graphics/ABI evidence and does not gate supported game platforms.\n\n## Epics\n\n${epics.map((epic, i) => `- [ ] ${registry.epics[String(i + 1)]?.url ?? `S3-E${i + 1}`} - ${epic.title}`).join('\n')}\n\n## Delivery gates\n\n- M0: published verified issue graph and tested upstream foundation fixes installed downstream.\n- M1: physical sustainable Roman economy.\n- M2: complete warfare, religion, and civilizations.\n- M3: ships, same-rules AI, skirmish, editor, and original campaigns.\n- M4: original presentation, complete saves, and measured true native parity.\n- M5: authoritative multiplayer and reusable signed/store releases.\n- M6: complete fidelity, rights, performance, security, installation, and distribution qualification.\n\n## Working rules\n\nFix defects at their owning source, retain reproductions there, run the repository's existing patch release, verify the published artifacts, update/release Stacks when affected, then install into this game. Preserve unrelated work through isolated worktrees. Normal pushes to origin/main as Chris, no attribution trailers, no force push. Production secrets are encrypted through buddy env into .env.production; decryption keys remain outside Git and client artifacts.\n\nThe roadmap has 107 implementation slots and 12 epics plus this index. Existing matching issues are reused. Durable spec, issue drafts, publishing state, and dependency definitions live under docs/roadmap. No issue is complete solely because this tracking graph exists.\n`
}

async function render(registry: Registry): Promise<void> {
  await mkdir(resolve(root, 'docs/roadmap/issues'), { recursive: true })
  for (const ticket of tickets) await Bun.write(resolve(root, `docs/roadmap/issues/${ticket.key}.md`), bodyFor(ticket, registry))
  const table = tickets.map(ticket => `| [${ticket.key}](${registry.tickets[ticket.key]?.url ?? `issues/${ticket.key}.md`}) | ${ticket.repository} | ${ticket.title} | ${ticket.blockers.join(', ') || 'None'} |`).join('\n')
  await Bun.write(resolve(root, 'docs/roadmap/README.md'), `# Settlers III Gold Edition roadmap\n\n${registry.master ? `Master issue: ${registry.master.url}` : 'Publishing has not completed yet.'}\n\nThe approved scope is recorded in [specification.md](specification.md). Source ownership and release rules are in [upstream-workflow.md](upstream-workflow.md). Each implementation issue has a durable [draft](issues/) and a stable identifier. The JSON registry records actual GitHub URLs, database IDs, relationship results, and issue states; the catalog records behavior, acceptance, tests, and dependencies.\n\n## Epics\n\n${epics.map((epic, i) => `- ${registry.epics[String(i + 1)]?.url ?? `S3-E${i + 1}`} - ${epic.title}`).join('\n')}\n\n## Implementation graph\n\n| Stable ID | Source owner | Deliverable | Blocked by |\n|---|---|---|---|\n${table}\n\n## Publish and verify\n\nRun \`bun scripts/roadmap.ts --check\` to validate and render local drafts. Run \`bun scripts/roadmap.ts --publish\` to reconcile the authorized GitHub graph. Run \`bun scripts/roadmap.ts --verify\` to read back issues and verify relationships. Publishing resumes from stable remote markers and preserves adopted issue content. It never closes implementation issues.\n`)
}

async function listIssues(repository: string): Promise<RemoteIssue[]> {
  const all: RemoteIssue[] = []
  for (let page = 1; ; page++) {
    const batch = await api<RemoteIssue[]>(`repos/${repository}/issues?state=all&per_page=100&page=${page}`)
    all.push(...batch.filter(issue => !issue.pull_request))
    if (batch.length < 100) return all
  }
}

async function ensureLabels(repository: string): Promise<void> {
  const existing = new Set((await pages<{ name: string }>(`repos/${repository}/labels`)).map(label => label.name))
  const labels: Record<string, string> = { 'settlers-gold': 'b99342', 'type:epic': '7057ff', 'type:feature': 'a2eeef', 'type:bug': 'b60205', 'type:research': '0075ca', 'priority:p0': 'b60205', 'priority:p1': 'fbca04', 'priority:p2': '0e8a16', 'ready-for-agent': '0e8a16' }
  for (let i = 1; i <= epics.length; i++) labels[`subsystem:${i.toString().padStart(2, '0')}`] = '1d76db'
  for (const name of ['browser', 'native', 'desktop', 'mobile', 'homeos']) labels[`platform:${name}`] = 'bfdadc'
  for (const [name, color] of Object.entries(labels)) if (!existing.has(name)) await api(`repos/${repository}/labels`, 'POST', { name, color, description: 'Settlers Gold Edition implementation roadmap' })
}

function platformLabels(ticket: Ticket): string[] {
  if (ticket.repository === 'home-lang/home-os') return ['platform:homeos']
  return ['platform:browser', 'platform:native', ...(ticket.epic === 2 || ticket.epic === 11 ? ['platform:desktop', 'platform:mobile'] : [])]
}

async function ensureIssue(repository: string, key: string, title: string, body: string, labels: string[], cached: RemoteIssue[], milestone?: number, reuse?: number): Promise<Entry> {
  let found = cached.find(issue => issue.body?.includes(marker(key)))
  if (!found && reuse) found = await api<RemoteIssue>(`repos/${repository}/issues/${reuse}`)
  if (found) {
    const adopted = reuse !== undefined && found.number === reuse
    const next = mergeGeneratedBody(found.body ?? '', key, body)
    const retainedLabels = found.labels.map(label => label.name).filter(label => label !== 'ready-for-agent' && (!label.startsWith('priority:') || !labels.some(current => current.startsWith('priority:'))))
    const nextLabels = [...new Set([...retainedLabels, ...labels])]
    const nextMilestone = adopted && found.milestone ? found.milestone.number : milestone
    if ((adopted || found.title === title) && found.body === next && found.milestone?.number === nextMilestone && found.labels.length === nextLabels.length && nextLabels.every(label => found.labels.some(actual => actual.name === label))) return entry(repository, found, adopted)
    const issue = await api<RemoteIssue>(`repos/${repository}/issues/${found.number}`, 'PATCH', { ...(adopted ? {} : { title }), body: next, milestone: nextMilestone, labels: nextLabels })
    return entry(repository, issue, adopted)
  }
  const issue = await api<RemoteIssue>(`repos/${repository}/issues`, 'POST', { title, body: mergeGeneratedBody('', key, body), labels, milestone })
  cached.push(issue)
  const result = entry(repository, issue)
  // Persist immediately in the caller; a remote marker recovers the narrow crash window.
  return result
}

async function ensureMilestones(repository: string): Promise<Map<string, number>> {
  const existing = await pages<{ title: string, number: number }>(`repos/${repository}/milestones?state=all`)
  const result = new Map(existing.map(item => [item.title, item.number]))
  for (const title of [...new Set(epics.map(epic => epic.milestone))]) {
    if (result.has(title)) continue
    const item = await api<{ number: number }>(`repos/${repository}/milestones`, 'POST', { title, description: `Settlers Gold completion gate: ${title}. Acceptance is evidence-based; no speculative due date.` })
    result.set(title, item.number)
  }
  return result
}

async function pages<T>(path: string): Promise<T[]> {
  const result: T[] = []
  for (let page = 1; ; page++) {
    const batch = await api<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    result.push(...batch)
    if (batch.length < 100) return result
  }
}

async function updateGenerated(item: Entry, key: string, body: string): Promise<void> {
  const remote = await api<RemoteIssue>(`repos/${item.repository}/issues/${item.number}`)
  await api(`repos/${item.repository}/issues/${item.number}`, 'PATCH', { body: mergeGeneratedBody(remote.body ?? '', key, body) })
}

export async function nativeRelationship<T>(operation: () => Promise<T>, recordRestriction: (reason: string) => void): Promise<T | undefined> {
  try { return await operation() }
  catch (error) {
    if (!String(error).match(/HTTP (403|404|422)/)) throw error
    recordRestriction(String(error).slice(0, 250))
    return undefined
  }
}

function recordRelationshipLimit(child: Entry, description: string, reason: string): void {
  child.relationshipLimits = [...new Set([...(child.relationshipLimits ?? []), `${description}: ${reason}`])]
}

async function linkParent(child: Entry, parent: Entry): Promise<void> {
  if (child.reused) {
    try {
      const existing = await api<RemoteIssue>(`repos/${child.repository}/issues/${child.number}/parent`)
      child.nativeParent = existing.id === parent.id
      if (!child.nativeParent) child.relationshipLimits = [`Preserved existing parent ${existing.html_url}`]
      return
    }
    catch (error) {
      if (String(error).includes('HTTP 404')) { /* No existing parent. Try attaching below. */ }
      else if (String(error).match(/HTTP (403|422)/)) {
        child.nativeParent = false
        recordRelationshipLimit(child, 'Could not inspect adopted parent; preserved remote relationships', String(error).slice(0, 250))
        return
      }
      else throw error
    }
  }
  const path = `repos/${parent.repository}/issues/${parent.number}/sub_issues`
  const listed = await nativeRelationship(() => api<RemoteIssue[]>(`${path}?per_page=100`), reason => recordRelationshipLimit(child, 'Native parent unavailable', reason))
  if (!listed) { child.nativeParent = false; return }
  if (listed.some(issue => issue.id === child.id)) { child.nativeParent = true; return }
  child.nativeParent = false
  await nativeRelationship(async () => { await api(path, 'POST', { sub_issue_id: child.id }); child.nativeParent = true }, reason => recordRelationshipLimit(child, 'Native parent rejected by GitHub', reason))
}

async function linkBlockers(child: Entry, blockers: Entry[]): Promise<void> {
  const path = `repos/${child.repository}/issues/${child.number}/dependencies/blocked_by`
  const listed = await nativeRelationship(() => api<RemoteIssue[]>(`${path}?per_page=100`), reason => {
    for (const blocker of blockers) recordRelationshipLimit(child, `Native blocker ${blocker.url} unavailable`, reason)
  })
  if (!listed) { child.nativeBlockers = []; return }
  const linked = new Set(listed.map(issue => issue.id))
  child.nativeBlockers = listed.map(issue => issue.html_url)
  for (const blocker of blockers) {
    if (linked.has(blocker.id)) continue
    await nativeRelationship(async () => { await api(path, 'POST', { issue_id: blocker.id }); child.nativeBlockers!.push(blocker.url) }, reason => recordRelationshipLimit(child, `Native blocker ${blocker.url} rejected by GitHub`, reason))
  }
}

async function publish(registry: Registry): Promise<void> {
  const repositories = [...new Set([gameRepository, ...tickets.map(ticket => ticket.repository)])]
  const lists = new Map<string, RemoteIssue[]>()
  const milestones = new Map<string, Map<string, number>>()
  for (const repository of repositories) {
    lists.set(repository, await listIssues(repository)); await ensureLabels(repository)
    milestones.set(repository, await ensureMilestones(repository))
    console.log(`Prepared ${repository}`)
  }
  registry.master = await ensureIssue(gameRepository, 'S3-MASTER', 'Settlers III Gold Edition: complete fidelity and cross-platform delivery', masterBody(registry), ['settlers-gold', 'type:epic', 'priority:p0'], lists.get(gameRepository)!)
  await persist(registry)
  for (const [i, epic] of epics.entries()) {
    const key = String(i + 1)
    registry.epics[key] = await ensureIssue(gameRepository, `S3-E${key.padStart(2, '0')}`, `Gold Edition epic ${key}: ${epic.title}`, epicBody(i + 1, registry), ['settlers-gold', 'type:epic', `subsystem:${key.padStart(2, '0')}`], lists.get(gameRepository)!, milestones.get(gameRepository)!.get(epic.milestone))
    await persist(registry)
  }
  const remoteForTicket = (ticket: Ticket): RemoteIssue | undefined => lists.get(ticket.repository)!.find(issue => issue.body?.includes(marker(ticket.key)) || issue.number === reuseIssues[ticket.key])
  const satisfied = new Set(tickets.filter(ticket => {
    const remote = remoteForTicket(ticket)
    return remote?.state === 'closed' && remote.state_reason === 'completed'
  }).map(ticket => ticket.key))
  for (const ticket of tickets) {
    const labels = ['settlers-gold', ticket.key === 'S3-001' || ticket.key === 'S3-002' || ticket.key === 'S3-003' || ticket.key === 'S3-008' ? 'type:research' : 'type:feature', `priority:${ticket.priority}`, `subsystem:${ticket.epic.toString().padStart(2, '0')}`]
    labels.push(...platformLabels(ticket))
    if (remoteForTicket(ticket)?.state !== 'closed' && ticket.blockers.every(key => satisfied.has(key))) labels.push('ready-for-agent')
    registry.tickets[ticket.key] = await ensureIssue(ticket.repository, ticket.key, `[${ticket.key}] ${ticket.title}`, bodyFor(ticket, registry), labels, lists.get(ticket.repository)!, milestones.get(ticket.repository)!.get(epics[ticket.epic - 1]!.milestone), reuseIssues[ticket.key])
    await persist(registry)
    console.log(`${ticket.key}: ${registry.tickets[ticket.key]!.url}`)
  }
  for (const [key, epic] of Object.entries(registry.epics)) {
    await updateGenerated(epic, `S3-E${key.padStart(2, '0')}`, epicBody(Number(key), registry))
    await linkParent(epic, registry.master)
    await persist(registry)
  }
  for (const ticket of tickets) {
    const current = registry.tickets[ticket.key]!
    await linkParent(current, registry.epics[String(ticket.epic)]!)
    await linkBlockers(current, ticket.blockers.map(key => registry.tickets[key]!))
    await persist(registry)
    console.log(`Linked ${ticket.key}`)
  }
  await updateGenerated(registry.master, 'S3-MASTER', masterBody(registry))
  await render(registry)
}

async function verify(registry: Registry): Promise<void> {
  if (!registry.master || Object.keys(registry.epics).length !== 12 || Object.keys(registry.tickets).length !== 107) throw new Error('Incomplete published registry')
  for (const ticket of tickets) if (!registry.tickets[ticket.key]) throw new Error(`Missing catalog entry: ${ticket.key}`)
  const entries = [registry.master, ...Object.values(registry.epics), ...Object.values(registry.tickets)]
  if (new Set(entries.map(item => item.id)).size !== 120 || new Set(entries.map(item => item.url)).size !== 120) throw new Error('Registry contains duplicate remote issues')
  for (const [key, item] of [['S3-MASTER', registry.master], ...Object.entries(registry.epics).map(([index, item]) => [`S3-E${index.padStart(2, '0')}`, item]), ...Object.entries(registry.tickets)] as [string, Entry][]) {
    const remote = await api<RemoteIssue>(`repos/${item.repository}/issues/${item.number}`)
    if (remote.id !== item.id || !remote.body?.includes(marker(key))) throw new Error(`Issue identity mismatch: ${key}`)
    if (remote.title !== item.title) throw new Error(`Incorrect title: ${key}`)
    if ((remote.milestone?.number ?? null) !== item.milestone) throw new Error(`Incorrect milestone: ${key}`)
    for (const label of item.labels.filter(label => label !== 'ready-for-agent')) if (!remote.labels.some(actual => actual.name === label)) throw new Error(`Missing label ${label}: ${key}`)
    item.state = remote.state
    item.stateReason = remote.state_reason ?? null
    const ticket = tickets.find(ticket => ticket.key === key)
    if (ticket) {
      if (!item.reused && remote.title !== `[${ticket.key}] ${ticket.title}`) throw new Error(`Title differs from catalog: ${key}`)
      if (!item.reused && remote.milestone?.title !== epics[ticket.epic - 1]!.milestone) throw new Error(`Milestone differs from catalog: ${key}`)
      const requiredLabels = ['settlers-gold', `priority:${ticket.priority}`, `subsystem:${ticket.epic.toString().padStart(2, '0')}`, ['S3-001', 'S3-002', 'S3-003', 'S3-008'].includes(key) ? 'type:research' : 'type:feature']
      requiredLabels.push(...platformLabels(ticket))
      for (const label of requiredLabels) if (!remote.labels.some(actual => actual.name === label)) throw new Error(`Required catalog label missing: ${key} ${label}`)
      for (const criterion of ticket.criteria) if (!remote.body.includes(criterion)) throw new Error(`Missing acceptance criterion: ${key}`)
      for (const blocker of ticket.blockers) if (!remote.body.includes(registry.tickets[blocker]!.url)) throw new Error(`Missing blocker body link: ${key}`)
      for (const blocker of ticket.blockers) {
        const url = registry.tickets[blocker]!.url
        if (!item.nativeBlockers?.includes(url) && !item.relationshipLimits?.some(reason => reason.includes(url))) throw new Error(`Unaccounted native dependency: ${key} -> ${blocker}`)
      }
      const shouldBeReady = remote.state === 'open' && ticket.blockers.every(blocker => completed(registry.tickets[blocker]))
      if (remote.labels.some(label => label.name === 'ready-for-agent') !== shouldBeReady) throw new Error(`Incorrect frontier label: ${key}`)
      if (!item.nativeParent && !item.relationshipLimits?.length) throw new Error(`Unaccounted native parent: ${key}`)
      if (item.nativeBlockers?.length) {
        const actual = await api<RemoteIssue[]>(`repos/${item.repository}/issues/${item.number}/dependencies/blocked_by?per_page=100`)
        for (const blocker of item.nativeBlockers) if (!actual.some(issue => issue.html_url === blocker)) throw new Error(`Missing native blocker: ${key}`)
      }
    }
    if (item.nativeParent) {
      const parent = await api<RemoteIssue>(`repos/${item.repository}/issues/${item.number}/parent`)
      const expected = ticket ? registry.epics[String(ticket.epic)]! : registry.master
      if (parent.id !== expected.id) throw new Error(`Incorrect native parent: ${key}`)
    }
    console.log(`Verified ${key}`)
  }
  await persist(registry)
  console.log('Verified 120 tracking entries, acceptance criteria, frontier labels, and recorded native relationships.')
}

if (import.meta.main) {
  validateCatalog()
  const registry = await readRegistry()
  const mode = Bun.argv[2] ?? '--check'
  if (mode === '--publish') await publish(registry)
  else if (mode === '--verify') await verify(registry)
  else if (mode !== '--check') throw new Error('Use --check, --publish, or --verify')
  await render(registry)
  console.log(`Catalog valid: ${tickets.length} implementation issues, ${epics.length} epics, one master.`)
}
