import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifiedDownload } from '../../scripts/lib/verified-download'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

test('a fresh download verifies written bytes and cached archives do not fetch again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe'), body = 'verified demo fixture'
  const hash = new Bun.CryptoHasher('sha256').update(body).digest('hex')
  let requests = 0
  const server = Bun.serve({ port: 0, fetch: () => { requests++; return new Response(body) } })
  try {
    await verifiedDownload(path, server.url.href, hash)
    expect(await readFile(path, 'utf8')).toBe(body)
    await verifiedDownload(path, server.url.href, hash)
    expect(requests).toBe(1)
  }
  finally { server.stop(true) }
})

test('checksum failures reject untrusted downloads and cached data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe'), hash = '0'.repeat(64)
  const server = Bun.serve({ port: 0, fetch: () => new Response('untrusted bytes') })
  try {
    await expect(verifiedDownload(path, server.url.href, hash)).rejects.toThrow('Demo checksum')
    expect(await Bun.file(path).exists()).toBe(false)
    await Bun.write(path, 'corrupt cached archive')
    await expect(verifiedDownload(path, server.url.href, hash)).rejects.toThrow('Demo checksum')
  }
  finally { server.stop(true) }
})

test('a transient original-host server error retries the same URL before verifying and publishing bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe'), body = 'verified retry fixture', hash = Bun.SHA256.hash(body, 'hex')
  let requests = 0
  const server = Bun.serve({ port: 0, fetch: () => ++requests === 1 ? new Response('Temporary host error', { status: 500 }) : new Response(body) })
  try {
    await verifiedDownload(path, server.url.href, hash)
    expect(requests).toBe(2)
    expect(await readFile(path, 'utf8')).toBe(body)
  }
  finally { server.stop(true) }
})

test('persistent server errors are bounded and never publish an archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe')
  let requests = 0
  const server = Bun.serve({ port: 0, fetch: () => { requests++; return new Response('Unavailable', { status: 503 }) } })
  try {
    await expect(verifiedDownload(path, server.url.href, '0'.repeat(64))).rejects.toThrow('Demo download failed: 503')
    expect(requests).toBe(3)
    expect(await Bun.file(path).exists()).toBe(false)
  }
  finally { server.stop(true) }
})

test('permanent errors and invalid successful bytes do not receive retry acceptance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  for (const status of [403, 404, 200]) {
    let requests = 0
    const path = join(directory, `${status}.exe`), server = Bun.serve({ port: 0, fetch: () => { requests++; return new Response('invalid bytes', { status }) } })
    try {
      await expect(verifiedDownload(path, server.url.href, '0'.repeat(64))).rejects.toThrow(status === 200 ? 'Demo checksum' : `Demo download failed: ${status}`)
      expect(requests).toBe(1)
      expect(await Bun.file(path).exists()).toBe(false)
    }
    finally { server.stop(true) }
  }
})

test('a stalled partial response retries without publishing or combining its incomplete bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe'), body = 'complete original fixture', hash = Bun.SHA256.hash(body, 'hex')
  let requests = 0, partialPublished = false, canceled = false
  const server = Bun.serve({ port: 0, async fetch() {
    if (++requests > 1) {
      partialPublished = await Bun.file(path).exists()
      return new Response(body)
    }
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('partial')) }, cancel() { canceled = true } }))
  } })
  // A caller may shorten the inactivity policy. All time and HTTP are real;
  // the production overall deadline and three-attempt cap remain unchanged.
  const download = verifiedDownload(path, server.url.href, hash, { idleTimeoutMs: 100 })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([download, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Stalled transfer did not recover')), 3000) })])
    expect(requests).toBe(2)
    expect(canceled).toBe(true)
    expect(partialPublished).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(body)
  }
  finally { clearTimeout(timer); server.stop(true); await download.catch(() => {}) }
})

test('a stalled response header retries within the same bounded transfer policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe'), body = 'verified after stalled headers'
  let requests = 0
  const server = Bun.serve({ port: 0, fetch: () => ++requests === 1 ? new Promise<Response>(() => {}) : new Response(body) })
  try {
    await verifiedDownload(path, server.url.href, Bun.SHA256.hash(body, 'hex'), { idleTimeoutMs: 100 })
    expect(requests).toBe(2)
    expect(await readFile(path, 'utf8')).toBe(body)
  }
  finally { server.stop(true) }
})

test('steady byte progress can take longer than the inactivity window without restarting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe'), body = 'abcdefghij'
  let requests = 0, timer: ReturnType<typeof setInterval> | undefined
  const server = Bun.serve({ port: 0, fetch() {
    requests++
    return new Response(new ReadableStream({ start(controller) {
      let position = 0
      timer = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(body[position++]!))
        if (position === body.length) { clearInterval(timer); controller.close() }
      }, 25)
    }, cancel() { clearInterval(timer) } }))
  } })
  try {
    await verifiedDownload(path, server.url.href, Bun.SHA256.hash(body, 'hex'), { idleTimeoutMs: 100 })
    expect(requests).toBe(1)
    expect(await readFile(path, 'utf8')).toBe(body)
  }
  finally { clearInterval(timer); server.stop(true) }
})

test('persistent inactivity stops after three attempts and cannot publish partial bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-verified-download-'))
  directories.push(directory)
  const path = join(directory, 'demo.exe')
  let requests = 0
  const server = Bun.serve({ port: 0, fetch() {
    requests++
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])) } }))
  } })
  try {
    await expect(verifiedDownload(path, server.url.href, '0'.repeat(64), { idleTimeoutMs: 50 })).rejects.toThrow('stalled awaiting response body (1 bytes received)')
    expect(requests).toBe(3)
    expect(await Bun.file(path).exists()).toBe(false)
    for (const idleTimeoutMs of [0, -1, 1.5, 30001, Number.POSITIVE_INFINITY]) await expect(verifiedDownload(path, server.url.href, '0'.repeat(64), { idleTimeoutMs })).rejects.toThrow(RangeError)
    expect(requests).toBe(3)
  }
  finally { server.stop(true) }
})
