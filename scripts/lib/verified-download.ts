export async function verifiedDownload(path: string, url: string, expectedSha256: string): Promise<void> {
  const file = Bun.file(path)
  const cached = await file.exists()
  let bytes: ArrayBuffer
  if (cached) bytes = await file.arrayBuffer()
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Demo download failed: ${response.status}`)
    bytes = await response.arrayBuffer()
  }
  const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256) throw new Error(`Demo checksum does not match the pinned original (${bytes.byteLength} bytes, SHA-256 ${actual})`)
  if (!cached) await Bun.write(path, bytes)
}
