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
