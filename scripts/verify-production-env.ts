import { getEnv, isValidPublicKey, publicKeyMatchesPrivateKey, resolveEnvPrivateKey } from '@stacksjs/env'

// Validate in memory. Never write decrypted values or include them in diagnostics.
const environment = '.env.production'
const content = await Bun.file(environment).text()
const assignments = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
const headers = assignments.filter(line => line.startsWith('DOTENV_PUBLIC_KEY_PRODUCTION='))
const header = headers.length === 1 ? /^DOTENV_PUBLIC_KEY_PRODUCTION="([^"\r\n]+)"$/.exec(headers[0]!) : null
if (!header || !isValidPublicKey(header[1])) throw new Error('Production public-key metadata is invalid')
for (const line of assignments) {
  if (line === headers[0]) continue
  if (!/^[A-Z][A-Z0-9_]*=["']?encrypted:/.test(line) || /^DOTENV_PRIVATE_KEY/.test(line))
    throw new Error('Production configuration contains an unexpected plaintext assignment')
}

const keysIndex = Bun.argv.indexOf('--keys-file')
const keysFile = keysIndex >= 0 ? Bun.argv[keysIndex + 1] : undefined
if (keysIndex >= 0 && !keysFile) throw new Error('--keys-file requires a path')
const options = { file: environment, ...(keysFile ? { keysFile } : {}) }
const privateKey = resolveEnvPrivateKey(options)
if (!privateKey) throw new Error('Production configuration could not be decrypted completely')
if (!publicKeyMatchesPrivateKey(header[1], privateKey)) throw new Error('Production public metadata does not match the selected private key')
const result = getEnv(undefined, options)
if (!result.success || !result.output) throw new Error('Production configuration could not be decrypted completely')
const values = JSON.parse(result.output) as Record<string, string>
if (values.APP_ENV !== 'production' || values.DEBUG !== 'false') throw new Error('Production environment flags are invalid')
if (values.APP_NAME !== 'The Settlers III Remake') throw new Error('Production application identity is invalid')
if (!/^base64:[A-Za-z0-9+/]{43}=$/.test(values.APP_KEY ?? '')) throw new Error('Production application key is invalid')
console.log('Verified encrypted production configuration and complete in-memory decryption; no values emitted.')
