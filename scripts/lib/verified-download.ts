import { setTimeout as delay } from 'node:timers/promises'

class DownloadResponseError extends Error {
  constructor(readonly status: number) { super(`Demo download failed: ${status}`) }
}

/** Inactivity is measured between headers/received bytes, not total transfer time. */
async function transfer(url: string, deadline: AbortSignal, idleTimeoutMs: number): Promise<ArrayBuffer> {
  const request = new AbortController(), signal = AbortSignal.any([deadline, request.signal])
  let phase = 'response headers', received = 0, timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let body: ReadableStream<Uint8Array> | null = null
  const watch = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => request.abort(new Error(`Demo transfer stalled awaiting ${phase} (${received} bytes received)`)), idleTimeoutMs)
  }
  try {
    watch()
    const response = await fetch(url, { signal })
    body = response.body
    if (!response.ok) throw new DownloadResponseError(response.status)
    phase = 'response body'; watch()
    reader = body?.getReader()
    if (!reader) return new ArrayBuffer(0)
    const chunks: Uint8Array[] = []
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (chunk.value.byteLength) { chunks.push(chunk.value); received += chunk.value.byteLength; watch() }
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes.buffer
  }
  finally {
    clearTimeout(timer)
    request.abort()
    try { if (reader) await reader.cancel(); else await body?.cancel() }
    catch { /* A transport failure can already have closed its reader. */ }
    reader?.releaseLock()
  }
}

/** A caller may require a shorter idle window, but cannot extend either guard. */
export async function verifiedDownload(path: string, url: string, expectedSha256: string, options: { idleTimeoutMs?: number } = {}): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? 30000
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1 || idleTimeoutMs > 30000) throw new RangeError('Download inactivity timeout must be an integer from 1 to 30000 milliseconds')
  const file = Bun.file(path)
  const cached = await file.exists()
  let bytes: ArrayBuffer
  if (cached) bytes = await file.arrayBuffer()
  else {
    // One deadline covers every attempt; retries never relax byte verification.
    const signal = AbortSignal.timeout(120000)
    for (let attempt = 0; ; attempt++) {
      try { bytes = await transfer(url, signal, idleTimeoutMs); break }
      catch (error) {
        signal.throwIfAborted()
        const retryable = error instanceof DownloadResponseError ? [500, 502, 503, 504].includes(error.status) : !(error instanceof RangeError)
        if (!retryable || attempt === 2) throw error
        console.warn(`Original demo transfer attempt ${attempt + 1} failed; retrying within the original deadline: ${String(error)}`)
      }
      await delay(1000 * (attempt + 1), undefined, { signal })
      signal.throwIfAborted()
    }
  }
  const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256) throw new Error(`Demo checksum does not match the pinned original (${bytes.byteLength} bytes, SHA-256 ${actual})`)
  if (!cached) await Bun.write(path, bytes)
}
