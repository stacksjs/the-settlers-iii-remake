import { resolve } from 'node:path'
import { contentPolicy } from '../docs/content/policy'
import { inspectContentBundle, requireContentPublication, validateContentPolicy } from './lib/content-provenance'

const root = resolve(import.meta.dir, '..')
const directory = resolve(root, 'public/assets/settlers-original')
if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    let channel = process.env.STACKS_PUBLICATION_CHANNEL
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--channel') {
        channel = args[++i]
        if (!channel || channel.startsWith('--')) throw new Error('--channel requires a publication channel')
      }
      else if (!['--verify', '--publication', '--inventory', '--json'].includes(args[i]!)) {
        throw new Error('Usage: bun scripts/content.ts --verify|--publication|--inventory [--channel web|preview|desktop|ios|android|github-release] [--json]')
      }
    }
    const modes = ['--verify', '--publication', '--inventory'].filter(mode => args.includes(mode))
    if (modes.length !== 1) throw new Error('Select exactly one content verification mode')
    validateContentPolicy(contentPolicy)
    const manifest = args.includes('--publication')
      ? await requireContentPublication(directory, root, contentPolicy, channel)
      : args.includes('--verify') ? await inspectContentBundle(directory, contentPolicy) : null
    const report = {
      schemaVersion: 1,
      operation: modes[0]!.slice(2),
      channel: args.includes('--publication') ? channel : null,
      sourceRights: contentPolicy.originalSources,
      inventory: contentPolicy.inventory,
      verifiedConvertedFiles: manifest?.files.length ?? null,
      verifiedSourceInputs: manifest?.inputs.length ?? null,
      publicationVerified: args.includes('--publication'),
    }
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(`Content inventory: ${contentPolicy.inventory.length} categories, ${manifest?.files.length ?? 0} verified converted files.`)
      console.log(args.includes('--publication') ? `Content publication verified for ${channel}.` : 'Provenance verification does not grant redistribution rights. No bundled publication is authorized by this check.')
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
