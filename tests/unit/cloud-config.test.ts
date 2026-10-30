import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const source = read('config/cloud.ts')

test('the public cloud config never names a server, host or address', () => {
  const addresses = source.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? []
  expect(addresses.filter(address => address !== '127.0.0.1')).toEqual([])
  expect(source).not.toMatch(/attachTo\s*:\s*['"`]/)
  expect(source).toContain('process.env.CLOUD_ATTACH_TO')
})

test('the web and API sites use ports the shared box owner does not, and mount the auth routes', () => {
  expect(source).toMatch(/const WEB_PORT = (?!3000\b)\d+/)
  expect(source).toMatch(/const API_PORT = (?!3008\b)\d+/)
  expect(source.match(/STACKS_DEFAULT_ROUTES: 'auth'/g)?.length).toBe(2)
})

test('every public page credits the original game and offers a way to object', () => {
  for (const path of ['resources/components/SiteFooter.stx', 'resources/components/ShowcaseFigure.stx', 'resources/views/play.stx']) {
    const page = read(path)
    expect(page, path).toContain('Blue Byte')
    expect(page, path).toContain('/credits')
  }
  expect(read('resources/components/SiteFooter.stx')).toContain('chris@stacksjs.com')
})

test('public pages keep to project style: no em-dashes and the game stays behind the page gate', () => {
  for (const path of ['index', 'credits', 'terms', 'privacy', 'login', 'register']) expect(read(`resources/views/${path}.stx`)).not.toMatch(/[—–]/)
  expect(read('resources/views/play.stx')).toContain("definePageMeta({ middleware: ['auth'] })")
})
