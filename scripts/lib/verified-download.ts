import { setTimeout as delay } from 'node:timers/promises'

export async function verifiedDownload(path: string, url: string, expectedSha256: string): Promise<void> {
  const file = Bun.file(path)
  const cached = await file.exists()
  let bytes: ArrayBuffer
  if (cached) bytes = await file.arrayBuffer()
  else {
    // One deadline covers every attempt; retries never relax byte verification.
    const signal = AbortSignal.timeout(120000)
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { signal })
      if (response.ok) { bytes = await response.arrayBuffer(); break }
      const retryable = [500, 502, 503, 504].includes(response.status)
      if (!retryable || attempt === 2) throw new Error(`Demo download failed: ${response.status}`)
      await response.body?.cancel()
      await delay(1000 * (attempt + 1), undefined, { signal })
      signal.throwIfAborted()
    }
  }
  const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256) throw new Error(`Demo checksum does not match the pinned original (${bytes.byteLength} bytes, SHA-256 ${actual})`)
  if (!cached) await Bun.write(path, bytes)
}
