import type { CheckpointStore } from '../../resources/game/checkpoint'
import { describe, expect, test } from 'bun:test'
import { createCheckpoints } from '../../resources/game/checkpoint'

/** Conditional commits model the public Storage contract; scheduling and failures are controlled. */
function memory() {
  const data = new Map<string, unknown>(), log: string[] = []
  let failure: Error | null = null, delay = 0
  const before = async (signal: AbortSignal) => {
    if (delay) await Bun.sleep(delay)
    signal.throwIfAborted()
    if (failure) throw failure
  }
  const store: CheckpointStore = {
    async get(key) { await Bun.sleep(0); return structuredClone(data.get(key)) },
    async setIfAbsent(key, value, signal) {
      await before(signal)
      if (data.has(key)) return false
      data.set(key, structuredClone(value)); log.push(key)
      return true
    },
    async compareAndSet(key, expected, value, signal) {
      await before(signal)
      if (!data.has(key) || JSON.stringify(data.get(key)) !== JSON.stringify(expected)) return false
      data.set(key, structuredClone(value)); log.push(key)
      return true
    },
  }
  return { store, data, log, failWith: (error: Error | null) => { failure = error }, slow: (ms: number) => { delay = ms } }
}

describe('checkpoints', () => {
  test('save coalescing preserves a load between earlier and later progress', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    m.slow(5)
    const first = c.save('one'), second = c.save('two')
    const loading = c.load()
    const third = c.save('three'), fourth = c.save('four')
    expect(await loading).toBe('two')
    expect(await Promise.all([first, second, third, fourth])).toEqual([
      { ok: true, generation: 1 }, { ok: true, generation: 2 },
      { ok: true, generation: 3 }, { ok: true, generation: 3 },
    ])
    expect(await c.load()).toBe('four')
    expect(m.log).toHaveLength(3)
  })

  test('disposal rejects queued loads without starting their storage reads', async () => {
    const m = memory(), read = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    let reads = 0
    const c = createCheckpoints({
      ...m.store,
      async get(key, signal) {
        reads++
        const value = await m.store.get(key, signal)
        read.resolve(); await release.promise
        return value
      },
    }, 'game')
    const active = c.load().then(() => false, error => error.name === 'AbortError')
    await read.promise
    const queued = c.load().then(() => false, error => error.name === 'AbortError')
    const saving = c.save('closed progress')
    c.dispose()
    expect(await queued).toBe(true)
    expect(await saving).toMatchObject({ ok: false, reason: 'superseded' })
    expect(reads).toBe(1)
    release.resolve()
    expect(await active).toBe(true)
    await c.flush()
    expect(reads).toBe(1)
    expect(m.log).toEqual([])
  })

  test('a save requested during a load waits for the loaded session before committing', async () => {
    const m = memory(), read = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    let pause = false
    const c = createCheckpoints({
      ...m.store,
      async get(key, signal) {
        const value = await m.store.get(key, signal)
        if (pause) { pause = false; read.resolve(); await release.promise }
        return value
      },
    }, 'game')
    await c.save('base'); await c.flush()
    pause = true
    const loading = c.load()
    await read.promise
    let acknowledged = false
    const saving = c.save('later progress').then(result => { acknowledged = true; return result })
    try {
      await Bun.sleep(0)
      expect(acknowledged).toBe(false)
    }
    finally { release.resolve() }
    expect(await loading).toBe('base')
    expect(await saving).toEqual({ ok: true, generation: 2 })
    expect(await c.save('third progress')).toEqual({ ok: true, generation: 3 })
    expect(await createCheckpoints(m.store, 'game').load()).toBe('third progress')
  })

  test('a session loaded before another commit cannot overwrite it with stale game state', async () => {
    const m = memory(), first = createCheckpoints(m.store, 'game')
    await first.save('base')
    const second = createCheckpoints(m.store, 'game')
    expect(await second.load()).toBe('base')
    expect(await first.save('newer progress')).toEqual({ ok: true, generation: 2 })
    expect(await second.save('older progress')).toMatchObject({ ok: false, reason: 'superseded' })
    expect(await createCheckpoints(m.store, 'game').load()).toBe('newer progress')
    expect(await second.load()).toBe('newer progress')
    expect(await second.save('resumed progress')).toEqual({ ok: true, generation: 3 })
    expect(await first.save('now stale too')).toMatchObject({ ok: false, reason: 'superseded' })
  })

  test('an older session cannot replace a checkpoint committed after its read', async () => {
    const m = memory(), original = createCheckpoints(m.store, 'game')
    expect(await original.save('base')).toMatchObject({ ok: true })
    await original.flush()
    const read = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    let first = true
    const earlier = createCheckpoints({
      ...m.store,
      async get(key, signal) {
        const value = await m.store.get(key, signal)
        if (first) { first = false; read.resolve(); await release.promise }
        return value
      },
    }, 'game')
    const waiting = earlier.save('earlier')
    await read.promise
    const later = createCheckpoints(m.store, 'game')
    expect(await later.save('later')).toMatchObject({ ok: true, generation: 2 })
    release.resolve()
    expect(await waiting).toMatchObject({ ok: false, reason: 'superseded' })
    expect(await earlier.save('stale queued state')).toMatchObject({ ok: false, reason: 'superseded' })
    expect(await createCheckpoints(m.store, 'game').load()).toBe('later')
    expect(await earlier.load()).toBe('later')
    expect(await earlier.save('resumed')).toMatchObject({ ok: true, generation: 3 })
  })

  test('success follows the actual atomic commit and retains the previous verified payload', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    m.slow(15)
    let acknowledged = false
    const saving = c.save('first').then(result => { acknowledged = true; return result })
    await Bun.sleep(2)
    expect(acknowledged).toBe(false)
    expect(m.data.has('game:checkpoint')).toBe(false)
    expect(await saving).toEqual({ ok: true, generation: 1 })
    expect(await c.save('second')).toEqual({ ok: true, generation: 2 })
    expect(await c.load()).toBe('second')
    const record = m.data.get('game:checkpoint') as { current: { text: string }, previous: { text: string } }
    expect(record.current.text).toBe('second')
    expect(record.previous.text).toBe('first')
  })

  test('concurrent creation admits one complete checkpoint and refuses the competing writer', async () => {
    const m = memory()
    const a = createCheckpoints(m.store, 'game'), b = createCheckpoints(m.store, 'game')
    const results = await Promise.all([a.save('A'), b.save('B')])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.reason === 'superseded')).toHaveLength(1)
    expect(await createCheckpoints(m.store, 'game').load()).toBe(results[0].ok ? 'A' : 'B')
  })

  test('pending saves coalesce in request order', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    m.slow(5)
    const results = await Promise.all([c.save('one'), c.save('two'), c.save('three'), c.save('four')])
    expect(results.map(result => result.ok && result.generation)).toEqual([1, 2, 2, 2])
    expect(m.log).toHaveLength(2)
    expect(await c.load()).toBe('four')
  })

  test('quota and rejected writes preserve the previous checkpoint and allow a later retry', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    await c.save('safe')
    m.failWith(new Error('QuotaExceededError: quota exceeded'))
    expect(await c.save('lost')).toMatchObject({ ok: false, reason: 'storage', message: 'Device storage is full. The previous checkpoint is kept.' })
    expect(await c.load()).toBe('safe')
    m.failWith(new Error('disk refused the replacement'))
    expect(await c.save('unconfirmed')).toMatchObject({ ok: false, reason: 'storage' })
    expect(await c.load()).toBe('safe')
    m.failWith(null)
    expect(await c.save('later')).toEqual({ ok: true, generation: 2 })
  })

  test('a damaged current payload recovers the previous verified value', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    await c.save('intact'); await c.save('newer')
    const record = m.data.get('game:checkpoint') as { current: { text: string } }
    record.current.text = 'corrupted'
    expect(await c.load()).toBe('intact')
    expect(await c.save('recovered')).toEqual({ ok: true, generation: 3 })
    expect(await c.load()).toBe('recovered')
  })

  test('legacy two-slot and single-key saves migrate without rewriting their source', async () => {
    const m = memory()
    const hash = (text: string) => Bun.SHA256.hash(text, 'hex')
    m.data.set('game:a', JSON.stringify({ generation: 5, sha256: hash('confirmed'), text: 'confirmed' }))
    m.data.set('game:b', JSON.stringify({ generation: 6, sha256: hash('unconfirmed'), text: 'unconfirmed' }))
    m.data.set('game:head', JSON.stringify({ version: 1, slot: 'a', generation: 5, sha256: hash('confirmed'), bytes: 9 }))
    const old = structuredClone([...m.data])
    const c = createCheckpoints(m.store, 'game')
    expect(await c.load()).toBe('confirmed')
    expect(await c.save('migrated')).toEqual({ ok: true, generation: 6 })
    expect([...m.data].filter(([key]) => key !== 'game:checkpoint')).toEqual(old)
    expect(await c.load()).toBe('migrated')
    m.data.set('old-save', 'legacy')
    expect(await createCheckpoints(m.store, 'other', 'old-save').load()).toBe('legacy')
  })

  test('disposal rejects active and queued saves without acknowledging an aborted commit', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    await c.save('kept'); await c.flush()
    m.slow(15)
    const active = c.save('active'), queued = c.save('queued')
    await Bun.sleep(2)
    c.dispose()
    expect(await queued).toMatchObject({ ok: false, reason: 'superseded' })
    expect(await active).toMatchObject({ ok: false, reason: 'disposed' })
    expect(await c.save('after')).toMatchObject({ ok: false, reason: 'disposed' })
    expect(await createCheckpoints(m.store, 'game').load()).toBe('kept')
  })

  test.each(['read', 'commit'] as const)('disposal during %s stops further requests even if the provider finishes', async (phase) => {
    const m = memory()
    await createCheckpoints(m.store, 'game').save('kept')
    const entered = Promise.withResolvers<void>(), complete = Promise.withResolvers<void>()
    const calls: string[] = []
    const c = createCheckpoints({
      ...m.store,
      async get(key, signal) {
        calls.push('read')
        const value = await m.store.get(key, signal)
        if (phase === 'read') { entered.resolve(); await complete.promise }
        return value
      },
      async compareAndSet(key, expected, value) {
        calls.push('commit')
        entered.resolve(); await complete.promise
        // An already-entered atomic operation may finish after caller cancellation.
        return m.store.compareAndSet(key, expected, value, new AbortController().signal)
      },
    }, 'game')
    const result = c.save('late')
    await entered.promise
    c.dispose()
    const atDisposal = [...calls]
    complete.resolve()
    expect(await result).toMatchObject({ ok: false, reason: 'disposed' })
    await c.flush()
    expect(calls).toEqual(atDisposal)
    expect(await createCheckpoints(m.store, 'game').load()).toBe(phase === 'commit' ? 'late' : 'kept')
  })

  test('invalid conditional responses fail closed', async () => {
    const m = memory()
    const c = createCheckpoints({ ...m.store, setIfAbsent: async () => undefined as unknown as boolean }, 'game')
    expect(await c.save('lost')).toMatchObject({ ok: false, reason: 'storage' })
    expect(await c.load()).toBeNull()
  })

  test.each((['save', 'load'] as const).flatMap(operation => ['checkpoint', 'head', 'a', 'legacy'].map(phase => [operation, phase] as const)))('disposal during an empty %s at %s starts no further reads or writes', async (operation, phase) => {
    const m = memory(), entered = Promise.withResolvers<void>(), complete = Promise.withResolvers<void>()
    const calls: string[] = []
    const c = createCheckpoints({
      ...m.store,
      async get(key, signal) {
        calls.push(key)
        const value = await m.store.get(key, signal)
        if (key === (phase === 'legacy' ? 'legacy' : `game:${phase}`)) { entered.resolve(); await complete.promise }
        return value
      },
    }, 'game', 'legacy')
    const pending = operation === 'save' ? c.save('closed') : c.load()
    await entered.promise
    const beforeDisposal = [...calls]
    c.dispose(); complete.resolve()
    if (operation === 'save') expect(await pending).toMatchObject({ ok: false, reason: 'disposed' })
    else await expect(pending).rejects.toThrow()
    expect(calls).toEqual(beforeDisposal)
    expect(m.log).toHaveLength(0)
  })

  test('flush waits for the pending commit', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    m.slow(10)
    void c.save('fresh')
    await c.flush()
    expect(await c.load()).toBe('fresh')
  })
})
