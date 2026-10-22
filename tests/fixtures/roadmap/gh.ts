import { readFileSync, writeFileSync } from 'node:fs'

interface Issue {
  id: number
  number: number
  html_url: string
  title: string
  body: string
  state: string
  labels: { name: string }[]
  milestone: { number: number, title: string } | null
}
interface Repository {
  issues: Issue[]
  labels: { name: string }[]
  milestones: { number: number, title: string }[]
}
interface Remote {
  nextId: number
  interrupted: boolean
  /** Repositories whose issue listing comes back empty, as an interrupted response did. */
  truncatedListings?: string[]
  repositories: Record<string, Repository>
  parents: Record<string, number>
  blockers: Record<string, number[]>
}

const statePath = process.env.ROADMAP_FAKE_STATE
if (!statePath) throw new Error('Fixture state path is required')
const state = JSON.parse(readFileSync(statePath, 'utf8')) as Remote
const args = process.argv.slice(2)
if (args[0] !== 'api' || args[1] !== '--method' || !args[3]) throw new Error('Unexpected fixture gh invocation')
const method = args[2]
const url = new URL(args[3], 'https://github.invalid/')
const match = /^\/repos\/([^/]+\/[^/]+)\/(.+)$/.exec(url.pathname)
if (!match?.[1] || !match[2]) throw new Error(`Unknown fixture endpoint: ${url.pathname}`)
const repositoryName = match[1]
const route = match[2].split('/')
const repository = state.repositories[repositoryName] ??= { issues: [], labels: [], milestones: [] }
const input = args.includes('--input') ? JSON.parse(await Bun.stdin.text()) as Record<string, unknown> : {}
const save = (): void => writeFileSync(statePath, JSON.stringify(state))
function output(value: unknown): never { console.log(JSON.stringify(value)); process.exit(0) }
function reject(status: number, reason: string): never { console.error(`HTTP ${status}: ${reason}`); process.exit(1) }
const issueById = (id: number): Issue | undefined => Object.values(state.repositories).flatMap(item => item.issues).find(issue => issue.id === id)
function page<T>(items: T[]): T[] {
  const size = Number(url.searchParams.get('per_page') ?? 30)
  const offset = (Number(url.searchParams.get('page') ?? 1) - 1) * size
  return items.slice(offset, offset + size)
}

if (route.length === 1 && route[0] === 'labels') {
  if (method === 'GET') output(page(repository.labels))
  if (method === 'POST') {
    const label = { name: String(input.name) }
    if (repository.labels.some(item => item.name === label.name)) reject(422, 'Duplicate label')
    repository.labels.push(label); save(); output(label)
  }
}
if (route.length === 1 && route[0] === 'milestones') {
  if (method === 'GET') output(page(repository.milestones))
  if (method === 'POST') {
    const milestone = { number: repository.milestones.length + 100, title: String(input.title) }
    repository.milestones.push(milestone); save(); output(milestone)
  }
}
if (route[0] !== 'issues') throw new Error(`Unknown fixture resource: ${url.pathname}`)
if (route.length === 1) {
  if (method === 'GET') output(state.truncatedListings?.includes(repositoryName) ? [] : page([...repository.issues].reverse()))
  if (method === 'POST') {
    const number = Math.max(0, ...repository.issues.map(issue => issue.number)) + 1
    const issue: Issue = {
      id: state.nextId++, number, html_url: `https://github.com/${repositoryName}/issues/${number}`,
      title: String(input.title), body: String(input.body), state: 'open',
      labels: (input.labels as string[]).map(name => ({ name })),
      milestone: repository.milestones.find(item => item.number === input.milestone) ?? null,
    }
    repository.issues.push(issue)
    // Commit remotely, then lose the response before the publisher can save it.
    if (!state.interrupted && issue.body.includes('<!-- settlers-gold:S3-025 -->')) {
      state.interrupted = true; save(); reject(500, 'Fixture lost the create response')
    }
    save(); output(issue)
  }
}
const issue = repository.issues.find(item => item.number === Number(route[1]))
if (!issue) reject(404, 'Issue not found')
if (route.length === 2) {
  if (method === 'GET') output(issue)
  if (method === 'PATCH') {
    if (input.title !== undefined) issue.title = String(input.title)
    if (input.body !== undefined) issue.body = String(input.body)
    if (input.labels !== undefined) issue.labels = (input.labels as string[]).map(name => ({ name }))
    if (input.milestone !== undefined) issue.milestone = repository.milestones.find(item => item.number === input.milestone) ?? null
    save(); output(issue)
  }
}
if (route[2] === 'parent' && method === 'GET') {
  const parent = issueById(state.parents[issue.id] ?? -1)
  if (!parent) reject(404, 'No parent')
  output(parent)
}
if (route[2] === 'sub_issues') {
  if (method === 'GET') {
    if (issue.body.includes('<!-- settlers-gold:S3-E02 -->')) reject(403, 'Fixture denies native child listing')
    output(page(Object.values(state.repositories).flatMap(item => item.issues).filter(item => state.parents[item.id] === issue.id)))
  }
  if (method === 'POST') {
    const child = issueById(Number(input.sub_issue_id))
    if (!child) reject(404, 'Child not found')
    if (state.parents[child.id]) reject(422, 'Child already has a parent')
    state.parents[child.id] = issue.id; save(); output(child)
  }
}
if (route[2] === 'dependencies' && route[3] === 'blocked_by') {
  if (method === 'GET') {
    if (issue.body.includes('<!-- settlers-gold:S3-010 -->')) reject(403, 'Fixture denies dependency listing')
    output(page((state.blockers[issue.id] ?? []).map(id => issueById(id))))
  }
  if (method === 'POST') {
    const blocker = issueById(Number(input.issue_id))
    if (!blocker) reject(404, 'Blocker not found')
    const existing = state.blockers[issue.id] ??= []
    if (existing.includes(blocker.id)) reject(422, 'Duplicate blocker')
    existing.push(blocker.id); save(); output(blocker)
  }
}
throw new Error(`Unhandled fixture request: ${method} ${url.pathname}`)
