import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspectContentBundle } from './content-provenance'
import type { ContentPolicy } from './content-provenance'

export interface ContentImportWorkspace { output: string, source: string }

/** Convert and validate before installation; temporaryRoot is caller-owned private storage outside both destinations. */
export async function importContentBundle(
  options: { directory: string, sourceDirectory: string, temporaryRoot: string, policy: ContentPolicy },
  convert: (workspace: ContentImportWorkspace) => Promise<void>,
): Promise<void> {
  await mkdir(options.temporaryRoot, { recursive: true })
  const workspace = await mkdtemp(join(options.temporaryRoot, 'content-import-'))
  let preserve = false, failure: { error: unknown } | undefined
  try {
    const output = join(workspace, 'bundle'), source = join(workspace, 'source')
    await mkdir(output); await mkdir(source)
    await convert(Object.freeze({ output, source }))
    await inspectContentBundle(output, options.policy)
    // Loading publication only after domain validation keeps failed conversion
    // independent of storage mutation and preserves the original failure.
    const { rename, StorageRenameRecoveryError } = await import('@stacksjs/storage/move')
    if (typeof StorageRenameRecoveryError !== 'function') throw new Error('The installed storage package does not support recoverable replacement')
    // Existing source-raster checks consume the complete extracted cache. These
    // two destinations are installed separately, with the public bundle last.
    for (const target of [
      { source, directory: options.sourceDirectory, name: 'Original source cache' },
      { source: output, directory: options.directory, name: 'Converted asset bundle' },
    ]) {
      await mkdir(dirname(target.directory), { recursive: true })
      const installed = await rename(target.source, target.directory, { overwrite: true })
      if (installed.isErr) {
        if (installed.error instanceof StorageRenameRecoveryError) {
          preserve = true
          console.error(`${target.name} requires storage inspection. Retained private workspace: ${workspace}. Native recovery state: ${installed.error.lock}`)
        }
        throw installed.error
      }
    }
  }
  catch (error) { failure = { error }; throw error }
  finally {
    if (!preserve) {
      try { await rm(workspace, { recursive: true, force: true }) }
      catch (error) {
        if (failure) throw new AggregateError([failure.error, error], `Asset import failed and its owned workspace could not be removed: ${workspace}`, { cause: failure.error })
        throw new Error(`Asset import completed but its owned workspace could not be removed: ${workspace}`, { cause: error })
      }
    }
  }
}
