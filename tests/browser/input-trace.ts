import type { Cdp } from '@stacksjs/testing/browser'
import { waitFor } from '@stacksjs/testing/browser'

export interface InputTraceReport {
  complete: boolean
  dataLoss: boolean
  dropped: number
  error: string | null
  events: unknown[]
}

/** Temporary guest-input diagnostics. No screenshots, network or JS sampling. */
export async function traceInput(cdp: Cdp) {
  const report: InputTraceReport = { complete: false, dataLoss: false, dropped: 0, error: null, events: [] }
  let started = false
  let stopping: Promise<void> | undefined
  cdp.on('Tracing.dataCollected', ({ value }: { value: unknown[] }) => {
    for (const event of value) {
      if (report.events.length < 50000) report.events.push(event)
      else report.dropped++
    }
  })
  cdp.on('Tracing.tracingComplete', ({ dataLossOccurred }: { dataLossOccurred?: boolean }) => {
    report.complete = true
    report.dataLoss = Boolean(dataLossOccurred)
  })
  try {
    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 4096, enableSampling: false, includedCategories: ['input', 'latencyInfo', 'benchmark'] },
    })
    started = true
  }
  catch (error) { report.error = String(error) }
  const stop = (): Promise<void> => stopping ??= (async () => {
    if (!started) return
    try {
      await cdp.send('Tracing.end')
      await waitFor(() => report.complete, 2000)
    }
    catch (error) { report.error = String(error) }
  })()
  return { report, stop }
}
