import type { FidelityContract } from '../resources/game/fidelity'
import { fidelityContract } from '../docs/fidelity/catalog'
import { fidelityReport, validateFidelityContract } from '../resources/game/fidelity'

export async function verifyFidelitySources(contract: FidelityContract, fetchSource: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<number> {
  validateFidelityContract(contract)
  for (const source of contract.sources) {
    const url = new URL(source.url)
    url.hostname = 'raw.githubusercontent.com'
    url.pathname = url.pathname.replace('/blob/', '/')
    const response = await fetchSource(url.toString(), { signal: AbortSignal.timeout(30_000) })
    if (!response.ok || !response.body) throw new Error(`Source fetch failed: ${source.id} (HTTP ${response.status})`)
    const reader = response.body.getReader()
    const hasher = new Bun.CryptoHasher('sha256')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > 1_048_576) throw new Error(`Source exceeds the 1 MiB evidence bound: ${source.id}`)
        hasher.update(next.value)
        chunks.push(next.value)
      }
    }
    finally {
      await reader.cancel()
      reader.releaseLock()
    }
    if (hasher.digest('hex') !== source.sha256) throw new Error(`Source checksum mismatch: ${source.id}`)
    const text = Buffer.concat(chunks).toString('utf8')
    for (const feature of contract.features.filter(item => item.evidence.source === source.id)) {
      if (!text.includes(`name="${feature.evidence.section}"`))
        throw new Error(`Missing documentary section: ${feature.id}/${feature.evidence.section}`)
    }
  }
  return contract.sources.length
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => !['--check', '--json', '--verify-sources'].includes(arg)))
      throw new Error('Usage: bun scripts/fidelity.ts [--check] [--json] [--verify-sources]')
    const report = fidelityReport(fidelityContract)
    const verifiedSources = args.includes('--verify-sources') ? await verifyFidelitySources(fidelityContract) : null
    if (args.includes('--json')) console.log(JSON.stringify({ ...report, verifiedSources }, null, 2))
    else {
      console.log(`Fidelity specification ${report.version}: ${report.editions.length} edition profiles, ${report.scope.systems} required systems, ${report.scope.targets.length} targets.`)
      console.log('Documentary specification only. Original executable revisions and runtime observations remain unverified.')
      if (verifiedSources !== null) console.log(`Verified ${verifiedSources} pinned source hashes and referenced documentary sections.`)
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
