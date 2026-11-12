import { config } from '@stacksjs/config'
import type { CapturedMessage } from '@stacksjs/email'
import { CaptureEmailDriver, mail } from '@stacksjs/email'
import type { StacksEvents } from '@stacksjs/events'
import { bootAppListeners, dispatchAndCollect, emitter, resetListenerRegistry } from '@stacksjs/events'
import { log } from '@stacksjs/logging'

export interface WelcomeCaptureReport {
  appName: string | undefined
  registered: number
  warnings: string[]
  errors: string[]
  results: { ok: boolean, error?: string }[]
  messages: Pick<CapturedMessage, 'to' | 'subject' | 'text'>[]
}

// This child owns its event bus and capture driver. The real application map
// still resolves the real action, including its native validation rules.
const payload = JSON.parse(process.argv[2] ?? 'null') as StacksEvents['user:registered']
const warnings: string[] = []
const errors: string[] = []
const previousDriver = mail.fake()

try {
  CaptureEmailDriver.clear()
  emitter.removeAllListeners()
  resetListenerRegistry()

  const registered = await bootAppListeners({
    base: process.cwd(),
    log: {
      warn: message => warnings.push(message),
      error: message => errors.push(message),
      info: () => {},
    },
  })
  const results = await dispatchAndCollect('user:registered', payload)
  const report: WelcomeCaptureReport = {
    appName: config.app.name,
    registered,
    warnings,
    errors,
    results: results.map(result => result.ok ? { ok: true } : { ok: false, error: String(result.error) }),
    messages: CaptureEmailDriver.all().map(message => ({
      to: message.to,
      subject: message.subject,
      text: message.text,
    })),
  }

  await log.flush()
  console.log(`SETTLERS_WELCOME_CAPTURE:${JSON.stringify(report)}`)
}
finally {
  mail.restoreDriver(previousDriver)
  CaptureEmailDriver.clear()
  emitter.removeAllListeners()
  resetListenerRegistry()
  await log.flush()
}
