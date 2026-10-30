import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encryptValue, generateKeypair } from '@stacksjs/env'

test('production configuration verification decrypts in memory and rejects unreadable or plaintext values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settlers-production-env-'))
  const keypair = generateKeypair()
  const appKey = `base64:${Buffer.alloc(32, 1).toString('base64')}`
  const values = { APP_NAME: 'The Settlers III Remake', APP_ENV: 'production', DEBUG: 'false', APP_KEY: appKey }
  const encrypted = `DOTENV_PUBLIC_KEY_PRODUCTION="${keypair.publicKey}"\n${Object.entries(values).map(([key, value]) => `${key}="${encryptValue(value, keypair.publicKey)}"`).join('\n')}\n`
  const script = resolve(import.meta.dir, '../../scripts/verify-production-env.ts')
  async function run(privateKey?: string, keysFile?: string): Promise<{ code: number, output: string }> {
    const child = Bun.spawn([process.execPath, '--no-env-file', script, ...(keysFile ? ['--keys-file', keysFile] : [])], {
      cwd: directory,
      env: { ...(privateKey ? { DOTENV_PRIVATE_KEY_PRODUCTION: privateKey } : {}) },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const output = `${stdout}\n${stderr}`
    expect(output).not.toContain(appKey)
    expect(output).not.toContain(keypair.privateKey)
    if (privateKey) expect(output).not.toContain(privateKey)
    return { code, output }
  }
  try {
    await Bun.write(join(directory, '.env.production'), encrypted)
    const valid = await run(keypair.privateKey)
    expect(valid.code, valid.output).toBe(0)
    expect(valid.output).toContain('complete in-memory decryption')
    const missing = await run()
    expect(missing.code).not.toBe(0)
    expect(missing.output).toContain('could not be decrypted completely')
    const wrong = await run(generateKeypair().privateKey)
    expect(wrong.code).not.toBe(0)
    const keysFile = join(directory, 'production.keys')
    await Bun.write(keysFile, `DOTENV_PRIVATE_KEY_PRODUCTION="${keypair.privateKey}"\n`)
    const localKeys = await run(undefined, keysFile)
    expect(localKeys.code, localKeys.output).toBe(0)
    const fileOverride = await run(generateKeypair().privateKey, keysFile)
    expect(fileOverride.code, fileOverride.output).toBe(0)
    await Bun.write(join(directory, '.env.production'), `${encrypted}EXTRA="${encryptValue('unreadable-extra', generateKeypair().publicKey)}"\n`)
    const unreadableExtra = await run(keypair.privateKey)
    expect(unreadableExtra.code).not.toBe(0)
    expect(unreadableExtra.output).toContain('could not be decrypted completely')
    expect(unreadableExtra.output).not.toContain('unreadable-extra')
    const header = `DOTENV_PUBLIC_KEY_PRODUCTION="${keypair.publicKey}"`
    for (const replacement of [
      `DOTENV_PUBLIC_KEY_PRODUCTION="${keypair.privateKey}"`,
      `DOTENV_PUBLIC_KEY_PRODUCTION="${generateKeypair().publicKey}"`,
      'DOTENV_PUBLIC_KEY_PRODUCTION="x25519-public:invalid"',
      `${header} PLAINTEXT_SECRET="must-not-be-accepted"`,
      `${header}\n${header}`,
      '',
    ]) {
      await Bun.write(join(directory, '.env.production'), encrypted.replace(header, replacement))
      const invalidHeader = await run(keypair.privateKey)
      expect(invalidHeader.code).not.toBe(0)
    }
    await Bun.write(join(directory, '.env.production'), `${encrypted}PLAINTEXT_SECRET="must-not-be-accepted"\n`)
    const plaintext = await run(keypair.privateKey)
    expect(plaintext.code).not.toBe(0)
    expect(plaintext.output).toContain('unexpected plaintext assignment')
    expect(plaintext.output).not.toContain('must-not-be-accepted')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
