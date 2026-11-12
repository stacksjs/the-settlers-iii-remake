import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { runIsolated, withDisposableDatabase } from '@stacksjs/testing'
import type { WelcomeCaptureReport } from '../fixtures/welcome-email-capture'

// Real registration dispatch and message capture catch app override mistakes.
// This seam does not establish HTTP registration or external mail delivery.
async function registration(payload: Record<string, unknown>): Promise<WelcomeCaptureReport> {
  return withDisposableDatabase('sqlite', async (database) => {
    const result = await runIsolated(resolve(import.meta.dir, '../fixtures/welcome-email-capture.ts'), {
      cwd: resolve(import.meta.dir, '../..'),
      envFile: false,
      env: {
        APP_ENV: 'test',
        NODE_ENV: 'test',
        APP_NAME: 'The Settlers Welcome Province',
        ...database.env,
      },
      args: [JSON.stringify(payload)],
      timeoutMs: 10_000,
    })
    const output = result.stdout + result.stderr
    expect(result.timedOut, output).toBe(false)
    expect(result.code, output).toBe(0)

    const prefix = 'SETTLERS_WELCOME_CAPTURE:'
    const records = result.stdout.split('\n').filter(line => line.startsWith(prefix))
    expect(records, output).toHaveLength(1)
    const report = JSON.parse(records[0]!.slice(prefix.length)) as WelcomeCaptureReport
    expect(report.appName).toBe('The Settlers Welcome Province')
    expect(report.registered).toBeGreaterThan(0)
    expect(report.errors).toEqual([])
    expect(report.results).toEqual([{ ok: true }])
    return report
  })
}

const address = 'welcome-capture@example.test'

test('registration welcome mail names the configured game', async () => {
  const report = await registration({ id: 1, email: address, to: address, name: 'Welcome Settler' })
  expect(report.warnings).toEqual([])
  expect(report.messages).toHaveLength(1)
  expect(report.messages[0]!.to).toBe(address)
  expect(report.messages[0]!.subject).toBe('Welcome to The Settlers Welcome Province!')
}, 20_000)

test('registration welcome mail accepts an absent optional name', async () => {
  const report = await registration({ id: 1, email: address, to: address })
  expect(report.warnings).toEqual([])
  expect(report.messages).toHaveLength(1)
  expect(report.messages[0]!.subject).toBe('Welcome to The Settlers Welcome Province!')
  expect(report.messages[0]!.text).toContain('Hi there,')
}, 20_000)

for (const [label, name] of [['five-character', 'Ada L'], ['hundred-character', 's'.repeat(100)]] as const) {
  test(`registration welcome mail accepts the ${label} name boundary`, async () => {
    const report = await registration({ id: 1, email: address, to: address, name })
    expect(report.warnings).toEqual([])
    expect(report.messages).toHaveLength(1)
    expect(report.messages[0]!.subject).toBe('Welcome to The Settlers Welcome Province!')
  }, 20_000)
}

const mismatches = [
  { label: 'a short name', payload: { id: 1, email: address, to: address, name: 'Abcd' }, field: 'name', validRecipient: true },
  { label: 'an overlong name', payload: { id: 1, email: address, to: address, name: 's'.repeat(101) }, field: 'name', validRecipient: true },
  { label: 'an invalid recipient', payload: { id: 1, email: address, to: 'not-an-address', name: 'Welcome Settler' }, field: 'to', validRecipient: false },
  { label: 'an absent required recipient', payload: { id: 1, email: address, name: 'Welcome Settler' }, field: 'to', validRecipient: false },
] as const

for (const { label, payload, field, validRecipient } of mismatches) {
  test(`registration diagnoses ${label} while still invoking its welcome action`, async () => {
    const report = await registration(payload)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain(`user:registered: payload does not match what SendWelcomeEmail declares (${field})`)
    // Event diagnostics do not suppress the handler. The real capture driver
    // separately rejects malformed addresses; returning is not mail delivery.
    expect(report.messages).toHaveLength(validRecipient ? 1 : 0)
    if (validRecipient)
      expect(report.messages[0]!.subject).toBe('Welcome to The Settlers Welcome Province!')
  }, 20_000)
}
