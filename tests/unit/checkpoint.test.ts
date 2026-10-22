import type { CheckpointStore } from '../../resources/game/checkpoint'
import { describe, expect, test } from 'bun:test'
import { createCheckpoints } from '../../resources/game/checkpoint'

/** An in-memory store whose writes can be delayed, refused or torn, like real device storage. */
function memory() {
  const data = new Map<string, string>(), log: string[] = []
  let fail: ((key: string) => Error | null) | null = null, tear: ((key: string) => boolean) | null = null, delay = 0
  const store: CheckpointStore = {
    async get(key) { await Bun.sleep(0); return data.get(key) },
    async set(key, value, signal) {
      if (delay) await Bun.sleep(delay)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const error = fail?.(key)
      if (error) throw error
      log.push(key)
      data.set(key, tear?.(key) ? value.slice(0, Math.floor(value.length / 2)) : value)
    },
  }
  return { store, data, log, failWith: (f: typeof fail) => { fail = f }, tearWhen: (f: typeof tear) => { tear = f }, slow: (ms: number) => { delay = ms } }
}

describe('checkpoints', () => {
  test('a save reports success only after the slot is verified and the head is stored', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    expect(await c.save('first')).toEqual({ ok: true, generation: 1 })
    expect(m.log).toEqual(['game:a', 'game:head'])
    expect(await c.save('second')).toEqual({ ok: true, generation: 2 })
    expect(m.log).toEqual(['game:a', 'game:head', 'game:b', 'game:head'])
    expect(await c.load()).toBe('second')
  })

  test('queued and concurrent saves run in order and collapse to the newest state', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    m.slow(5)
    const results = await Promise.all([c.save('one'), c.save('two'), c.save('three'), c.save('four')])
    // The first write was already running; the next three collapse into a single write of the newest.
    expect(results.map(r => r.ok && r.generation)).toEqual([1, 2, 2, 2])
    expect(m.log).toEqual(['game:a', 'game:head', 'game:b', 'game:head'])
    expect(await c.load()).toBe('four')
  })

  test('a refused or quota-limited write keeps the previous checkpoint', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    await c.save('safe')
    m.failWith(key => (key === 'game:b' ? new Error('QuotaExceededError: quota exceeded') : null))
    expect(await c.save('lost')).toMatchObject({ ok: false, reason: 'storage', message: 'Device storage is full. The previous checkpoint is kept.' })
    expect(await c.load()).toBe('safe')
    m.failWith(key => (key === 'game:head' ? new Error('denied') : null))
    expect(await c.save('unconfirmed')).toMatchObject({ ok: false, reason: 'storage' })
    // The slot was written but never confirmed by the head: the confirmed checkpoint wins.
    expect(await c.load()).toBe('safe')
    m.failWith(null)
    expect(await c.save('later')).toMatchObject({ ok: true })
    expect(await c.load()).toBe('later')
  })

  test('a torn write is detected on read-back and recovery uses the previous checkpoint', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    await c.save('intact')
    m.tearWhen(key => key === 'game:b')
    expect(await c.save('torn')).toMatchObject({ ok: false, reason: 'verify' })
    expect(await c.load()).toBe('intact')
    // Corrupting the head's own slot after the fact also falls back to the other intact slot.
    m.tearWhen(null)
    await c.save('newer')
    m.data.set('game:b', '{"generation":2,"sha256":"00","text":"garbage"}')
    expect(await c.load()).toBe('intact')
    // Without a readable head the newest intact slot is used.
    m.data.set('game:head', 'not json')
    expect(await c.load()).toBe('intact')
  })

  test('disposal during a write and while saves are queued never reports a false success', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game')
    await c.save('kept')
    await c.flush()
    m.slow(10)
    const running = c.save('in flight'), waiting = c.save('queued')
    await Bun.sleep(2)
    c.dispose()
    expect(await waiting).toMatchObject({ ok: false, reason: 'superseded' })
    expect(await running).toMatchObject({ ok: false, reason: 'disposed' })
    expect(await c.save('after')).toMatchObject({ ok: false, reason: 'disposed' })
    expect(await createCheckpoints(m.store, 'game').load()).toBe('kept')
  })

  test('flush waits for the write in progress, and a legacy single-key save is still found', async () => {
    const m = memory(), c = createCheckpoints(m.store, 'game', 'old-save')
    m.data.set('old-save', 'legacy')
    expect(await c.load()).toBe('legacy')
    m.slow(5)
    void c.save('fresh')
    await c.flush()
    expect(m.log.at(-1)).toBe('game:head')
    expect(await c.load()).toBe('fresh')
  })
})
