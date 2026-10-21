import { compareOriginalObservations, observationFixtureFingerprint, verifyOriginalObservation } from './lib/original-observation'

async function json(path: string | undefined): Promise<unknown> {
  if (!path) throw new Error('A JSON path is required')
  const file = Bun.file(path)
  if (file.size > 1_048_576) throw new Error('Observation metadata exceeds 1 MiB')
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of file.stream()) {
    total += chunk.byteLength
    if (total > 1_048_576) throw new Error('Observation metadata exceeds 1 MiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'fingerprint' && args.length === 1) {
      console.log(JSON.stringify(observationFixtureFingerprint(await json(args[0])), null, 2))
    }
    else if (command === 'verify' && args.length === 4) {
      const report = await verifyOriginalObservation(await json(args[0]), await json(args[1]), { original: args[2]!, evidence: args[3]! })
      console.log(JSON.stringify(report, null, 2))
      if (report.status !== 'complete-candidate') process.exitCode = 2
    }
    else if (command === 'compare' && (args.length === 6 || args.length === 7)) {
      const fixture = await json(args[0])
      const first = await verifyOriginalObservation(fixture, await json(args[1]), { original: args[3]!, evidence: args[4]! })
      const second = await verifyOriginalObservation(fixture, await json(args[2]), { original: args[3]!, evidence: args[5]! })
      const comparison = compareOriginalObservations(first, second, args[6] === undefined ? 0 : Number(args[6]))
      console.log(JSON.stringify(comparison, null, 2))
      if (comparison.status !== 'matching-candidates') process.exitCode = 2
    }
    else {
      throw new Error('Usage: original-observations fingerprint fixture.json | verify fixture.json run.json original-root evidence-root | compare fixture.json first.json second.json original-root first-evidence second-evidence [tolerance-ms]')
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
