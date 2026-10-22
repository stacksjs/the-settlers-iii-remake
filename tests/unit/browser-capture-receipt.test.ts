import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

async function run(capture: boolean, exitCode: number) {
  const root = await mkdtemp(join(tmpdir(), 'settlers-capture-receipt-'))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ready') })
  try {
    const defaults = join(root, 'node_modules/@stacksjs/defaults')
    const driver = join(defaults, 'ai/skills/stacks-browse/scripts')
    const shots = join(root, 'storage/framework/runtime/shots')
    await mkdir(driver, { recursive: true })
    await mkdir(shots, { recursive: true })
    await writeFile(join(defaults, 'package.json'), JSON.stringify({ name: '@stacksjs/defaults', version: '0.0.0' }))
    await writeFile(join(shots, 'campaign.png'), png)
    await writeFile(join(driver, 'browse.ts'), `
if (${capture}) await Bun.write(Bun.argv[Bun.argv.indexOf('--out') + 1], Buffer.from(${JSON.stringify(png.toString('base64'))}, 'base64'))
console.log(JSON.stringify({ steps: [] }))
process.exit(${exitCode})
`)
    const child = Bun.spawn([process.execPath, '--no-env-file', resolve(import.meta.dir, '../browser/campaign.ts'), `http://127.0.0.1:${server.port}/`], {
      cwd: root, env: { PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe', timeout: 10000,
    })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const media = JSON.parse(await readFile(join(shots, 'campaign-media.json'), 'utf8'))
    return { code, output: `${stdout}\n${stderr}`, media }
  }
  finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
}

test('a successful driver without a new capture cannot claim a stale screenshot', async () => {
  const result = await run(false, 0)
  expect(result.code, result.output).not.toBe(0)
  expect(result.media.screenshot).toBeNull()
  expect(result.media.captureStatus).toBe('not-captured')
}, 15000)

test('a failed driver retains its exit status without claiming an old capture', async () => {
  const result = await run(false, 7)
  expect(result.code, result.output).not.toBe(0)
  expect(result.media.browserExitCode).toBe(7)
  expect(result.media.screenshot).toBeNull()
}, 15000)

test('a new capture retains its actual hash and dimensions', async () => {
  const result = await run(true, 0)
  expect(result.code, result.output).toBe(0)
  expect(result.media.screenshot).toMatchObject({ sha256: new Bun.CryptoHasher('sha256').update(png).digest('hex'), bytes: png.length, width: 1, height: 1 })
}, 15000)
