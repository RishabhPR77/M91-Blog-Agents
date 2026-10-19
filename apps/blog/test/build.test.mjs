// Blog build-output tests (Phase 7 B8). No network: real Astro builds into test/.tmp with fixture posts.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, extname, dirname } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = join(root, 'test', '.tmp')
const SITE = 'https://m91-blog.embarko.app'

function build(contentDir, outDir) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'astro.mjs'), 'build', '--outDir', outDir], {
    cwd: root,
    env: { ...process.env, BLOG_CONTENT_DIR: contentDir },
    encoding: 'utf8'
  })
  return { code: r.status, output: `${r.stdout}\n${r.stderr}` }
}

const read = (dist, p) => readFileSync(join(dist, p), 'utf8')
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))

const dist = join(tmp, 'dist')
let built
before(() => {
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  cpSync(join(root, 'test', 'fixtures', 'posts'), join(tmp, 'content'), { recursive: true })
  built = build(join(tmp, 'content'), dist)
})

test('the fixture build succeeds; every post page exists with title, canonical, OG image and valid JSON-LD', () => {
  assert.equal(built.code, 0, built.output.slice(-2000))
  for (const slug of ['fixture-indexed-post', 'fixture-hidden-post', 'fixture-blocks-post']) {
    const html = read(dist, `posts/${slug}/index.html`)
    assert.match(html, /<title>Fixture: /)
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}/posts/${slug}/">`), slug)
    assert.ok(html.includes(`<meta property="og:image" content="${SITE}/og/${slug}.png">`), slug)
    assert.ok(existsSync(join(dist, 'og', `${slug}.png`)), `OG image for ${slug}`)
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
    assert.deepEqual(ld.map((x) => x['@type']), ['BlogPosting', 'BreadcrumbList'])
    assert.equal(ld[0].mainEntityOfPage['@id'], `${SITE}/posts/${slug}/`)
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'none'">/)
  }
  const home = read(dist, 'index.html')
  assert.equal(JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@type'], 'Blog')
  assert.ok(existsSync(join(dist, 'og', 'default.png')) && existsSync(join(dist, '404.html')))
})

test('the noindex post has the robots meta and is absent from home, topics, RSS, sitemap and llms.txt', () => {
  assert.match(read(dist, 'posts/fixture-hidden-post/index.html'), /<meta name="robots" content="noindex, nofollow">/)
  assert.doesNotMatch(read(dist, 'posts/fixture-indexed-post/index.html'), /name="robots"/)
  const lists = {
    home: read(dist, 'index.html'),
    topic: read(dist, 'topics/human-approval-for-ai-agents/index.html'),
    rss: read(dist, 'rss.xml'),
    sitemap: readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => read(dist, f)).join('\n'),
    llms: read(dist, 'llms.txt')
  }
  for (const [name, text] of Object.entries(lists)) {
    assert.ok(!text.includes('fixture-hidden-post'), `${name} must not list the noindex post`)
    assert.ok(text.includes('fixture-indexed-post'), `${name} lists the indexed post`)
  }
  assert.ok(!lists.sitemap.includes('/404/'))
  assert.match(read(dist, 'robots.txt'), /Sitemap: https:\/\/m91-blog\.embarko\.app\/sitemap-index\.xml/)
})

test('raw HTML in Markdown is not rendered; code is highlighted with a copy button; tables scroll; blocks fall back to Markdown', () => {
  const html = read(dist, 'posts/fixture-indexed-post/index.html')
  const body = html.slice(html.indexOf('class="prose-m91"'), html.indexOf('id="cta-title"'))
  // The tags are dropped (their inner text stays as plain, escaped text): nothing is rendered as HTML.
  assert.ok(!/<script[^>]*>[^<]*alert\(1\)/.test(html), 'no script element from the post')
  assert.ok(!body.includes('<b>') && !body.includes('</b>'), 'no <b> from the post')
  assert.match(body, /Raw HTML that must not render: alert\(1\) and bold-raw-html\./)
  assert.ok(!body.includes('class="evil"'), 'no raw div')
  assert.match(body, /<pre class="shiki/)
  assert.match(body, /<div class="table-wrap"[^>]*><table>/)
  assert.match(body, /<a href="https:\/\/m91\.msg91\.com\/llms\.txt" rel="noopener noreferrer" target="_blank">/)
  assert.match(body, /<a href="\/posts\/fixture-hidden-post\/">internal link<\/a>/, 'internal links stay in the same tab')
  assert.match(html, /\.copy-code|copy-code/)
  const blocks = read(dist, 'posts/fixture-blocks-post/index.html')
  assert.match(blocks, /data-blocks-unsupported="1"/)
  assert.match(blocks, /The Markdown fallback for a post with blocks\./)
})

test('every internal link and asset in dist/ points to an existing file', () => {
  const missing = []
  for (const file of files(dist).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8')
    for (const m of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      let target = m[1]
      if (target.startsWith(SITE)) target = target.slice(SITE.length) || '/'
      if (!target.startsWith('/') || target.startsWith('//')) continue
      const path = join(dist, decodeURI(target.split('?')[0]))
      const ok = extname(path) ? existsSync(path) : existsSync(join(path, 'index.html'))
      if (!ok) missing.push(`${file.slice(dist.length)} → ${target}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('a build with an invalid post fails with a clear message', () => {
  const bad = join(tmp, 'bad-content')
  mkdirSync(bad, { recursive: true })
  const post = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'posts', 'fixture-indexed-post.json'), 'utf8'))
  writeFileSync(join(bad, 'broken.json'), JSON.stringify({ ...post, slug: 'Not A Slug', tldr: ['only one'] }))
  const r = build(bad, join(tmp, 'bad-dist'))
  assert.notEqual(r.code, 0)
  assert.match(r.output, /Invalid post file broken\.json \(format v1\)/)
  assert.match(r.output, /\/slug must match pattern/)
})

test('a production build never includes samples/ (an empty content folder builds an empty blog)', () => {
  const empty = join(tmp, 'empty-content')
  mkdirSync(empty, { recursive: true })
  const out = join(tmp, 'empty-dist')
  const r = build(empty, out)
  assert.equal(r.code, 0, r.output.slice(-2000))
  assert.ok(!existsSync(join(out, 'posts')), 'no post pages')
  const all = files(out).filter((f) => /\.(html|xml|txt)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.ok(!all.includes('sample-'), 'no sample post anywhere')
  assert.ok(!all.includes('data-sample-badge'), 'no sample badge')
  assert.match(read(out, 'index.html'), /No posts here yet\./)
})
