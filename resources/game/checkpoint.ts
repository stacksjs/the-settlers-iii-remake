import { sha256 } from './engine/hash'

/** The storage a host provides: Craft's Storage service in browsers and native shells, a map in tests. */
export interface CheckpointStore {
  get: (key: string, signal: AbortSignal) => Promise<unknown>
  set: (key: string, value: string, signal: AbortSignal) => Promise<void>
}
export interface Head { version: 1, slot: 'a' | 'b', generation: number, sha256: string, bytes: number }
export type SaveResult = { ok: true, generation: number } | { ok: false, reason: 'storage' | 'verify' | 'disposed' | 'superseded', message: string }

/**
 * Two-slot checkpoints. A save writes the slot the head does not point at, reads
 * it back, and only then moves the head, so an interrupted, refused or torn write
 * always leaves the previous checkpoint loadable. Saves run one at a time in
 * request order; requests made while a write is running collapse into one write
 * of the newest state. A save reports success only after the head is stored.
 */
export function createCheckpoints(store: CheckpointStore, prefix: string, legacyKey?: string) {
  const lifetime = new AbortController()
  let head: Head | null | undefined, running: Promise<void> | null = null
  let queued: { text: string, waiters: ((result: SaveResult) => void)[] } | null = null
  const key = (name: string): string => `${prefix}:${name}`
  const disposed = (): SaveResult => ({ ok: false, reason: 'disposed', message: 'The game was closed while the checkpoint was being written.' })

  async function readHead(): Promise<Head | null> {
    const raw = await store.get(key('head'), lifetime.signal)
    if (typeof raw !== 'string') return null
    try {
      const value = JSON.parse(raw) as Head
      return value?.version === 1 && (value.slot === 'a' || value.slot === 'b') && Number.isSafeInteger(value.generation) && /^[0-9a-f]{64}$/.test(value.sha256) ? value : null
    }
    catch { return null }
  }
  async function readSlot(slot: 'a' | 'b'): Promise<{ generation: number, text: string } | null> {
    const raw = await store.get(key(slot), lifetime.signal)
    if (typeof raw !== 'string') return null
    try {
      const value = JSON.parse(raw) as { generation: number, sha256: string, text: string }
      return Number.isSafeInteger(value?.generation) && typeof value.text === 'string' && sha256(value.text) === value.sha256 ? { generation: value.generation, text: value.text } : null
    }
    catch { return null }
  }

  async function write(text: string): Promise<SaveResult> {
    if (lifetime.signal.aborted) return disposed()
    try {
      head ??= await readHead()
      if (lifetime.signal.aborted) return disposed()
      const slot = head?.slot === 'a' ? 'b' : 'a', generation = (head?.generation ?? 0) + 1, digest = sha256(text)
      await store.set(key(slot), JSON.stringify({ generation, sha256: digest, text }), lifetime.signal)
      if (lifetime.signal.aborted) return disposed()
      const stored = await readSlot(slot)
      if (lifetime.signal.aborted) return disposed()
      if (!stored || stored.generation !== generation || stored.text !== text) return { ok: false, reason: 'verify', message: 'The checkpoint did not read back intact. The previous checkpoint is kept.' }
      const next: Head = { version: 1, slot, generation, sha256: digest, bytes: text.length }
      await store.set(key('head'), JSON.stringify(next), lifetime.signal)
      if (lifetime.signal.aborted) return disposed()
      head = next
      return { ok: true, generation }
    }
    catch (error) {
      // Whatever failed, the head still names the last complete checkpoint.
      head = undefined
      if (lifetime.signal.aborted) return disposed()
      return { ok: false, reason: 'storage', message: error instanceof Error && /quota/i.test(error.message) ? 'Device storage is full. The previous checkpoint is kept.' : 'Device storage refused the checkpoint. The previous checkpoint is kept.' }
    }
  }

  function drain(): void {
    if (running || !queued) return
    const job = queued
    queued = null
    running = write(job.text).then(result => { for (const done of job.waiters) done(result) }).finally(() => { running = null; drain() })
  }

  return {
    /** Requests a checkpoint of serialized state. Later requests made while one is writing replace earlier queued ones. */
    save(text: string): Promise<SaveResult> {
      if (lifetime.signal.aborted) return Promise.resolve(disposed())
      return new Promise((resolve) => {
        if (queued) { queued.text = text; queued.waiters.push(resolve) }
        else queued = { text, waiters: [resolve] }
        drain()
      })
    },
    /** The newest intact checkpoint: the head's slot, else the other slot, else the legacy single-key save. */
    async load(): Promise<string | null> {
      const current = await readHead()
      const slots = (await Promise.all((['a', 'b'] as const).map(async slot => ({ slot, value: await readSlot(slot) })))).filter(s => s.value)
      const preferred = current && slots.find(s => s.slot === current.slot && s.value!.generation === current.generation && sha256(s.value!.text) === current.sha256)
      // Without a valid head, never prefer an unconfirmed newer slot over a confirmed older one: a slot
      // ahead of the head was written by a save that never completed.
      const fallback = slots.filter(s => !current || s.value!.generation <= current.generation).sort((a, b) => b.value!.generation - a.value!.generation)[0]
      const chosen = preferred ?? fallback
      if (chosen) return chosen.value!.text
      if (legacyKey) { const legacy = await store.get(legacyKey, lifetime.signal); return typeof legacy === 'string' ? legacy : null }
      return null
    },
    /** Waits for the write in progress, if any. Used before the host suspends or closes. */
    async flush(): Promise<void> { while (running || queued) { drain(); await running } },
    dispose(): void {
      lifetime.abort()
      const pending = queued
      queued = null
      for (const done of pending?.waiters ?? []) done({ ok: false, reason: 'superseded', message: 'The game was closed before the checkpoint was written.' })
    },
  }
}
export type Checkpoints = ReturnType<typeof createCheckpoints>
