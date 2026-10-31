import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPost, loadPosts, renderPostBody } from '@stacksjs/cms/blog'

const dir = join(import.meta.dir, '../../content/blog')

describe('the blog', () => {
  test('lists the first post, featured, with the fields the index and the feed need', () => {
    const posts = loadPosts()
    expect(posts.length).toBeGreaterThan(0)
    const first = posts.find(post => post.slug === 'we-grew-up-with-this-game')!
    expect(first).toBeDefined()
    expect(first.featured).toBe(true)
    expect(first.title).toContain('carry on')
    expect(first.description.length).toBeGreaterThan(40)
    expect(first.author).toBeTruthy()
    expect(first.minutes).toBeGreaterThan(1)
  })

  test('every post is complete, speaks as fans, credits the owners and carries no em or en dashes', () => {
    for (const file of readdirSync(dir).filter(name => name.endsWith('.md'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/[–—]/)
      const post = loadPost(file.replace(/\.md$/, ''))
      expect(post, file).not.toBeNull()
      expect(post!.title.length).toBeGreaterThan(0)
      expect(post!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const first = loadPost('we-grew-up-with-this-game')!
    expect(first.body).toContain('We are fans')
    expect(first.body).toContain('still fun')
    expect(first.body).toContain('Blue Byte')
    expect(first.body).toContain('Ubisoft')
    expect(first.body).toContain('not affiliated')
  })

  test('the index links the feed where the server publishes it', () => {
    const index = readFileSync(join(import.meta.dir, '../../resources/views/blog.stx'), 'utf8')
    expect(index).toContain('href="/blog/feed.xml"')
    expect(index).not.toContain('href="/feed.xml"')
  })

  test('renders its body as HTML with real headings and lists', () => {
    const html = renderPostBody(loadPost('we-grew-up-with-this-game')!.body)
    expect(html).toContain('<h2')
    expect(html).toContain('<li>')
    expect(loadPost('../etc/passwd')).toBeNull()
    expect(loadPost('no-such-post')).toBeNull()
  })

  test('states only counts the simulation actually has', async () => {
    const { ROMAN_ENGINEERING } = await import('../../resources/game/engine')
    const body = loadPost('we-grew-up-with-this-game')!.body
    expect(body).toContain(`${ROMAN_ENGINEERING.buildings.length} Roman building types and ${ROMAN_ENGINEERING.goods.length} goods`)
  })
})
