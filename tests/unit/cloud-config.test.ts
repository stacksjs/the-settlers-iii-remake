import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dir, '../../config/cloud.ts'), 'utf8')

test('the public cloud config never names a server, host or address', () => {
  expect(source).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)
  expect(source).not.toMatch(/attachTo\s*:\s*['"`]/)
  expect(source).toContain('process.env.CLOUD_ATTACH_TO')
})

test('only the built marketing page is declared for deployment', () => {
  expect(source).toMatch(/root:\s*'dist\/marketing'/)
  expect(source).toContain('--pages resources/views/marketing')
  expect(source).toContain('--public resources/marketing/public')
  expect(source).not.toMatch(/start:\s*'/)
  expect(source).not.toContain("root: '.'")
})

test('the marketing page carries no original media and no em-dashes', () => {
  const html = readFileSync(resolve(import.meta.dir, '../../resources/views/marketing/index.stx'), 'utf8')
  expect(html).not.toMatch(/\.(png|jpg|jpeg|wav|mp3|dat)\b/i)
  expect(html).not.toMatch(/[—–]/)
})
