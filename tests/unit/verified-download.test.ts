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
