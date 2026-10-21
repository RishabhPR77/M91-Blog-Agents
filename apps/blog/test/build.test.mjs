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

test('the noindex post has the robots meta and is absent from home, RSS, sitemap and llms.txt', () => {
  assert.match(read(dist, 'posts/fixture-hidden-post/index.html'), /<meta name="robots" content="noindex, nofollow">/)
  assert.doesNotMatch(read(dist, 'posts/fixture-indexed-post/index.html'), /name="robots"/)
  const lists = {
    home: read(dist, 'index.html'),
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

test('raw HTML in Markdown is not rendered; code is highlighted with a copy button; tables scroll', () => {
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
  assert.match(read(out, 'index.html'), /No posts yet\./)
})

// ---------- Phase 8: interactive blocks ----------

const EVERY = 'posts/fixture-every-block-post/index.html'
const count = (html, re) => (html.match(re) ?? []).length
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'none'"

test('every built block renders complete HTML without JavaScript, in order; JS-only controls are marked js-only', () => {
  const html = read(dist, EVERY)
  assert.match(html, /<div class="prose-m91 blocks" data-blocks="21">/)
  const order = [...html.matchAll(/<(?:aside|section|div|ol|figure)[^>]*data-block="([a-z_]+)"/g)].map((m) => m[1])
  assert.deepEqual(order, ['callout', 'steps_checklist', 'phone_ring_sim', 'code_tabs', 'comparison_table', 'escalation_timeline', 'agent_terminal_replay', 'choice_explorer', 'faq_accordion', 'troubleshooting_picker'])
  // callout
  assert.match(html, /<aside class="callout callout-warning"[^>]*aria-label="Warning">/)
  assert.match(html, /Never auto-approve when the answer is missing\./)
  // steps_checklist: real checkboxes with labels; the progress line is JS-only
  assert.equal(count(html, /<input type="checkbox" class="checklist-box"/g), 3)
  assert.match(html, /<p class="checklist-progress js-only" aria-live="polite"><span data-done>0<\/span> of 3 done<\/p>/)
  assert.match(html, /data-key="m91-blog:fixture-every-block-post:b\d+"/)
  assert.match(html, /<p>Create a channel in M91\.\nWhat you should see: a send link\.<\/p>|<p>Create a channel in M91\. What you should see: a send link\.<\/p>/)
  // phone_ring_sim: the moments as a list with actor icons; the phone mockup is JS-only, with fixed labels
  assert.equal(count(html, /<li class="phonesim-moment/g), 4)
  assert.match(html, /<span class="sr-only">The agent:<\/span>/)
  assert.match(html, /<div class="phonesim-phone js-only" aria-hidden="true">/)
  for (const label of ['Waiting for a person…', 'Ringing…', '>Approve<', '>Reject<', 'Continuing…']) assert.ok(html.includes(label), label)
  assert.match(html, /data-state="deciding" data-decision="approve"/)
  // code_tabs: both versions highlighted; ARIA tabs behind js-only; labels without JS
  assert.match(html, /<div class="codetabs-list js-only" role="tablist" aria-label="Code versions">/)
  assert.equal(count(html, /role="tab" id="blk-b\d+-tab-\d"/g), 2)
  assert.equal(count(html, /<p class="codetabs-label no-js-only">(Terminal|JavaScript)<\/p>/g), 2)
  assert.equal(count(html, /role="tabpanel"[\s\S]*?<pre class="shiki/g), 2)
  // comparison_table: column names on every cell for the phone cards
  assert.equal(count(html, /data-label="Wakes a person"/g), 2)
  // faq_accordion: native details
  assert.equal(count(html, /<details class="faq-item" id="/g), 2)
  // escalation_timeline, agent_terminal_replay
  assert.equal(count(html, /<li class="timeline-step">/g), 3)
  assert.equal(count(html, /<div class="terminal-line">/g), 4)
  assert.match(html, /<div class="terminal-line">\$ agent run deploy<\/div>/)
  assert.match(html, /<button type="button" class="terminal-replay js-only" data-replay>Watch again<\/button>/)
  // choice_explorer: without JS each choice in bold with its outcome; buttons are JS-only
  assert.match(html, /<p class="choice-label no-js-only"><strong>Short timeout<\/strong><\/p>/)
  assert.match(html, /<div class="choices-buttons js-only" role="radiogroup"/)
  assert.match(html, /Tap a choice to see what happens\./)
  // troubleshooting_picker
  assert.equal(count(html, /<div class="troubleshoot-item" id="/g), 2)
  assert.match(html, /<div class="troubleshoot-fix"><p>Fix: use a public HTTPS URL\.<\/p><\/div>/)
  assert.match(html, /What are you seeing\?/)
})

test('block scripts: one bundled file per block type from self, only on pages that use it; the CSP meta is unchanged', () => {
  const html = read(dist, EVERY)
  // Every page also loads the footer's script (Copy setup prompt); the block scripts are the rest.
  const srcs = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.includes('/Footer.astro'))
  assert.equal(srcs.length, 8, 'checklist, phone, tabs, timeline, terminal, choices, faq, troubleshooting')
  for (const src of srcs) {
    assert.match(src, /^\/_astro\/[A-Za-z]+\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/)
    assert.ok(existsSync(join(dist, src)), src)
  }
  assert.ok(!/<script type="module">/.test(html), 'no inline module scripts')
  assert.ok(!/ on[a-z]+="/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline event handlers')
  const plain = [...read(dist, 'posts/fixture-indexed-post/index.html').matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1])
  assert.ok(plain.every((s) => s.includes('/Footer.astro')), 'a post without blocks loads no block script')
  for (const p of [EVERY, 'posts/fixture-indexed-post/index.html', 'index.html']) assert.ok(read(dist, p).includes(`content="${CSP}"`), p)
})

test('heading anchors still work: contents links resolve, questions and problems keep their heading ids', () => {
  const html = read(dist, EVERY)
  const toc = html.match(/<nav aria-labelledby="toc-title"[\s\S]*?<\/nav>/)[0]
  const anchors = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
  assert.ok(anchors.length >= 10)
  assert.deepEqual(anchors.filter((a) => !ids.has(a)), [])
  assert.match(html, /<details class="faq-item" id="does-m91-work-in-silent-mode">/)
  assert.match(html, /<div class="troubleshoot-item" id="the-phone-does-not-ring"/)
  assert.match(html, /<h2 id="set-it-up">Set it up<a [^>]*href="#set-it-up"/)
})

test('raw HTML inside block Markdown is not rendered; external links in blocks open safely', () => {
  const html = read(dist, EVERY)
  assert.ok(!html.includes('<b>raw-in-block</b>'))
  assert.ok(!/<script[^>]*>[^<]*alert\(2\)/.test(html))
  assert.match(html, /Add the link to your server raw-in-block/)
  assert.match(html, /<a href="https:\/\/m91\.msg91\.com\/" rel="noopener noreferrer" target="_blank">Try M91<\/a>/)
})

test('fallbacks: a block type that is not built shows the whole Markdown; invalid block data is dropped at load; both warn', () => {
  assert.equal(built.code, 0)
  assert.match(built.output, /\[blocks\] fixture-blocks-post: block b2: "diagram" is not built yet: showing the post's Markdown instead/)
  assert.match(built.output, /\[blocks\] fixture-invalid-blocks-post\.json: blocks not valid, showing the post's Markdown instead/)
  const notBuilt = read(dist, 'posts/fixture-blocks-post/index.html')
  assert.match(notBuilt, /<div class="prose-m91" data-blocks-fallback>/)
  assert.match(notBuilt, /The Markdown fallback for a post with blocks\./)
  assert.ok(!notBuilt.includes('data-block='))
  const invalid = read(dist, 'posts/fixture-invalid-blocks-post/index.html')
  assert.match(invalid, /Invalid blocks are dropped: this Markdown is shown\./)
  assert.ok(!invalid.includes('data-blocks'))
})

test('the every-block sample is a valid post that builds with all 21 blocks', async () => {
  const { validatePost } = await import('@m91/content')
  const sample = JSON.parse(readFileSync(join(root, 'samples', 'sample-every-block.json'), 'utf8'))
  assert.deepEqual(validatePost(sample), { valid: true, errors: [] })
  const content = join(tmp, 'content-sample')
  mkdirSync(content, { recursive: true })
  cpSync(join(root, 'samples', 'sample-every-block.json'), join(content, 'sample-every-block.json'))
  const out = join(tmp, 'dist-sample')
  const r = build(content, out)
  assert.equal(r.code, 0, r.output.slice(-800))
  assert.ok(!/\[blocks\]/.test(r.output), 'no block warnings')
  assert.match(read(out, 'posts/sample-every-block/index.html'), /data-blocks="21"/)
})

test('the home page looks like the M91 site: ruled paper, heading, search, lime cards; no topic pages or filters', () => {
  const home = read(dist, 'index.html')
  assert.match(home, /<section class="ruled/)
  assert.match(home, /<p class="eyebrow">Blog<\/p>/)
  assert.match(home, /<h1 class="h-display[^"]*">Notes on waking people up\.<\/h1>/)
  assert.match(home, /<input id="post-search" type="search"/)
  assert.match(home, /<article class="bl-card" data-search="[^"]*fixture/)
  assert.ok(!home.includes('Plain guides on human approval'), 'no subtitle line')
  assert.ok(!existsSync(join(dist, 'topics')), 'no topic pages')
  assert.ok(!home.includes('href="/topics/'), 'no topic links')
  // The header is the M91 site's: its sections, Blog marked as this page, Docs and the download menu.
  assert.match(home, /href="https:\/\/m91\.msg91\.com\/#how" class="nav-link nav-extra"/)
  assert.match(home, /href="\/" class="nav-link" aria-current="page">Blog</)
  assert.match(home, /<details class="dl">/)
  // The footer: the setup prompt button and the site's columns and legal links.
  assert.match(home, /data-copy-prompt="Set up M91 alerting in this project/)
  for (const href of ['https://m91-api.msg91.com/llms.txt', 'https://github.com/MSG91/m91-skill', 'mailto:support@msg91.com', 'https://msg91.com/terms', 'https://apps.apple.com/app/id6759090472']) {
    assert.ok(home.includes(`href="${href}"`), href)
  }
})
