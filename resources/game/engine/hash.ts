// Pure TypeScript digests shared by the browser, Bun server and native hosts, so
// rules identities and state checksums never depend on a platform crypto API.
const K = Uint32Array.from([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
])

export function sha256(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const length = ((bytes.length + 9 + 63) >> 6) << 6
  const data = new Uint8Array(length)
  data.set(bytes); data[bytes.length] = 0x80
  const view = new DataView(data.buffer)
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, (bytes.length << 3) >>> 0)
  const h = Uint32Array.from([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19])
  const w = new Uint32Array(64)
  const rotate = (x: number, n: number): number => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!
      w[i] = (w[i - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0
    }
    let [a, b, c, d, e, f, g, k] = h as unknown as number[]
    for (let i = 0; i < 64; i++) {
      const t1 = (k! + (rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + w[i]!) >>> 0
      const t2 = ((rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0
      k = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = h[0]! + a!; h[1] = h[1]! + b!; h[2] = h[2]! + c!; h[3] = h[3]! + d!; h[4] = h[4]! + e!; h[5] = h[5]! + f!; h[6] = h[6]! + g!; h[7] = h[7]! + k!
  }
  return Array.from(h, value => value.toString(16).padStart(8, '0')).join('')
}

/** Canonical JSON: object keys sorted, typed arrays as plain arrays, no undefined members. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Canonical values must be finite')
    return JSON.stringify(value) ?? 'null'
  }
  if (ArrayBuffer.isView(value)) return `[${Array.from(value as unknown as ArrayLike<number>).join(',')}]`
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
  return `{${entries.map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
}

export const digest = (value: unknown): string => sha256(canonical(value))
