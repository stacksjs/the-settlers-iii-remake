import { sha256 } from './engine/hash'

/** Craft's public atomic Storage operations. Native hosts and Web Locks own serialization. */
export interface CheckpointStore {
  get: (key: string, signal: AbortSignal) => Promise<unknown>
  setIfAbsent: (key: string, value: unknown, signal: AbortSignal) => Promise<boolean>
  compareAndSet: (key: string, expected: unknown, value: unknown, signal: AbortSignal) => Promise<boolean>
}
export interface Head { version: 1, slot: 'a' | 'b', generation: number, sha256: string, bytes: number }
interface Payload { generation: number, sha256: string, text: string }
interface Record { version: 2, current: Payload, previous: Payload | null }
interface Snapshot { raw: unknown, current: Payload | null, generation: number }
export type SaveResult = { ok: true, generation: number } | { ok: false, reason: 'storage' | 'verify' | 'disposed' | 'superseded', message: string }
interface SaveJob { kind: 'save', text: string, waiters: ((result: SaveResult) => void)[] }
interface LoadJob { kind: 'load', resolve: (text: string | null) => void, reject: (error: unknown) => void }

/** One conditional commit contains both the current and previous verified payload. */
export function createCheckpoints(store: CheckpointStore, prefix: string, legacyKey?: string) {
  const lifetime = new AbortController()
  let running: Promise<void> | null = null, conflicted = false
  let observed: Snapshot | null = null
  const queue: (SaveJob | LoadJob)[] = []
  const key = (name: string): string => `${prefix}:${name}`
  async function readValue(name: string): Promise<unknown> {
    lifetime.signal.throwIfAborted()
    const value = await store.get(name, lifetime.signal)
    lifetime.signal.throwIfAborted()
    return value
  }
  const disposed = (): SaveResult => ({ ok: false, reason: 'disposed', message: 'The game was closed while the checkpoint was being written.' })
  const conflict = (): SaveResult => ({ ok: false, reason: 'superseded', message: 'Another game session changed the checkpoint. Reload this page before saving again.' })
  const payload = (value: unknown): Payload | null => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as Payload
    return Number.isSafeInteger(candidate.generation) && candidate.generation >= 0 && typeof candidate.text === 'string'
      && sha256(candidate.text) === candidate.sha256 ? { generation: candidate.generation, sha256: candidate.sha256, text: candidate.text } : null
  }

  /** Read-only migration from the previous two-slot protocol. */
  async function legacy(): Promise<Payload | null> {
    const raw = await readValue(key('head'))
    let head: Head | null = null
    if (typeof raw === 'string') {
      try {
        const value = JSON.parse(raw) as Head
        if (value.version === 1 && (value.slot === 'a' || value.slot === 'b') && Number.isSafeInteger(value.generation) && value.generation >= 0 && /^[0-9a-f]{64}$/.test(value.sha256)) head = value
      }
      catch { /* An intact slot can recover an unreadable legacy head. */ }
    }
    const slots = await Promise.all((['a', 'b'] as const).map(async (slot) => {
      const raw = await readValue(key(slot))
      try { return { slot, value: typeof raw === 'string' ? payload(JSON.parse(raw)) : null } }
      catch { return { slot, value: null } }
    }))
    const preferred = head && slots.find(entry => entry.slot === head.slot && entry.value?.generation === head.generation && entry.value.sha256 === head.sha256)
    const fallback = slots.filter(entry => entry.value && (!head || entry.value.generation <= head.generation)).sort((a, b) => b.value!.generation - a.value!.generation)[0]
    const chosen = preferred || fallback
    if (chosen?.value) return chosen.value
    if (legacyKey) {
      const text = await readValue(legacyKey)
      if (typeof text === 'string') return { generation: 0, sha256: sha256(text), text }
    }
    return null
  }

  async function read(): Promise<Snapshot> {
    const raw = await readValue(key('checkpoint'))
    if (raw === null || raw === undefined) {
      const current = await legacy()
      return { raw: null, current, generation: current?.generation ?? 0 }
    }
    if (typeof raw !== 'object' || (raw as Record).version !== 2) throw new Error('The saved checkpoint format is not supported.')
    const record = raw as Record
    const current = payload(record.current), previous = payload(record.previous)
    if (!current && !previous) throw new Error('The saved checkpoint failed verification.')
    const generation = Math.max(current?.generation ?? 0, previous?.generation ?? 0, Number.isSafeInteger(record.current?.generation) && record.current.generation >= 0 ? record.current.generation : 0)
    return { raw, current: current ?? previous, generation }
  }

  async function write(text: string): Promise<SaveResult> {
    if (lifetime.signal.aborted) return disposed()
    if (conflicted) return conflict()
    try {
      // Commit against what this session loaded or last committed. Reading a
      // newer checkpoint here would allow older in-memory game state to win.
      const saved = observed ?? await read()
      if (lifetime.signal.aborted) return disposed()
      observed = saved
      const generation = saved.generation + 1
      if (!Number.isSafeInteger(generation)) return { ok: false, reason: 'verify', message: 'The checkpoint generation is invalid. The previous checkpoint is kept.' }
      const next: Record = { version: 2, current: { generation, sha256: sha256(text), text }, previous: saved.current }
      const committed = saved.raw === null
        ? await store.setIfAbsent(key('checkpoint'), next, lifetime.signal)
        : await store.compareAndSet(key('checkpoint'), saved.raw, next, lifetime.signal)
      if (lifetime.signal.aborted) return disposed()
      if (typeof committed !== 'boolean') throw new Error('Storage returned an invalid conditional commit result')
      if (!committed) { conflicted = true; return conflict() }
      observed = { raw: next, current: next.current, generation }
      return { ok: true, generation }
    }
    catch (error) {
      if (lifetime.signal.aborted) return disposed()
      return { ok: false, reason: 'storage', message: error instanceof Error && /quota/i.test(error.message) ? 'Device storage is full. The previous checkpoint is kept.' : 'Device storage refused the checkpoint. The previous checkpoint is kept.' }
    }
  }

  function drain(): void {
    if (running || !queue.length) return
    const job = queue.shift()!
    const execute = async (): Promise<void> => {
      if (job.kind === 'save') {
        const result = await write(job.text)
        for (const done of job.waiters) done(result)
      }
      else {
        try {
          const saved = await read()
          lifetime.signal.throwIfAborted()
          observed = saved
          conflicted = false
          job.resolve(saved.current?.text ?? null)
        }
        catch (error) { job.reject(error) }
      }
    }
    running = execute().finally(() => { running = null; drain() })
  }
  async function flush(): Promise<void> { while (running || queue.length) { drain(); await running } }

  return {
    /** Coalesces pending requests; each success follows one actual atomic commit. */
    save(text: string): Promise<SaveResult> {
      if (lifetime.signal.aborted) return Promise.resolve(disposed())
      return new Promise((resolve) => {
        const pending = queue.at(-1)
        if (pending?.kind === 'save') { pending.text = text; pending.waiters.push(resolve) }
        else queue.push({ kind: 'save', text, waiters: [resolve] })
        drain()
      })
    },
    /** Loads form an ordering boundary, so later saves cannot rewind their session base. */
    load(): Promise<string | null> {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason)
      return new Promise((resolve, reject) => {
        queue.push({ kind: 'load', resolve, reject })
        drain()
      })
    },
    flush,
    dispose(): void {
      lifetime.abort()
      for (const pending of queue.splice(0)) {
        if (pending.kind === 'load') pending.reject(lifetime.signal.reason)
        else for (const done of pending.waiters) done({ ok: false, reason: 'superseded', message: 'The game was closed before the checkpoint was written.' })
      }
    },
  }
}
export type Checkpoints = ReturnType<typeof createCheckpoints>
