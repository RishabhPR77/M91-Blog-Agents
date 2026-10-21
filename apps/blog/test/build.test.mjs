// Blog build-output tests (Phase 7 B8). No network: real Astro builds into test/.tmp with fixture posts.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, extname, dirname } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = join(root, 'test', '.tmp')
const SITE = 'https://m91-blog.embarko.app'

function build(contentDir, outDir, env = {}) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'astro.mjs'), 'build', '--outDir', outDir], {
    cwd: root,
    env: { ...process.env, BLOG_CONTENT_DIR: contentDir, ...env },
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
  const body = html.slice(html.indexOf('class="prose-m91"'), html.indexOf('class="gp-end"'))
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
  assert.match(read(out, 'index.html'), /No guides yet\./)
})

// ---------- Phase 8: interactive blocks ----------

const EVERY = 'posts/fixture-every-block-post/index.html'
const count = (html, re) => (html.match(re) ?? []).length
const SHELL = /\/(Footer|Motion|StoryScene|GuideRail)\.astro_/
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
  // Every page loads the shell's scripts (Copy setup prompt and motion; on posts also the scene and the rail);
  // the block scripts are the rest.
  const srcs = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !SHELL.test(s))
  assert.equal(srcs.length, 8, 'checklist, phone, tabs, timeline, terminal, choices, faq, troubleshooting')
  for (const src of srcs) {
    assert.match(src, /^\/_astro\/[A-Za-z]+\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/)
    assert.ok(existsSync(join(dist, src)), src)
  }
  assert.ok(!/<script type="module">/.test(html), 'no inline module scripts')
  assert.ok(!/ on[a-z]+="/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline event handlers')
  const plain = [...read(dist, 'posts/fixture-indexed-post/index.html').matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1])
  assert.ok(plain.every((s) => SHELL.test(s)), 'a post without blocks loads no block script')
  for (const p of [EVERY, 'posts/fixture-indexed-post/index.html', 'index.html']) assert.ok(read(dist, p).includes(`content="${CSP}"`), p)
})

test('heading anchors still work: contents links resolve, questions and problems keep their heading ids', () => {
  const html = read(dist, EVERY)
  const toc = html.match(/<nav class="rail-card" aria-labelledby="toc-title">[\s\S]*?<\/nav>/)[0]
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

test('the guides home: hero with stats, one bar of chips and search, Start here, numbered cards, prompt strip', () => {
  const home = read(dist, 'index.html')
  assert.match(home, /<section class="ruled">/)
  assert.match(home, /<p class="eyebrow">M91 Guides<\/p>/)
  assert.match(home, /<h1 class="gh-h1">When software needs <span class="acc">you<\/span>\.<\/h1>/)
  assert.match(home, /<dt class="mono-k">Guides<\/dt><dd class="gh-stat-v">\d+<\/dd>/)
  // One bar only (chips + search), hidden without JS; chips only for topics that have a guide.
  assert.equal(count(home, /class="gh-bar js-only"/g), 1)
  assert.equal(count(home, /<input id="post-search" type="search"/g), 1)
  assert.match(home, /data-chip="all">All <span class="pill-n">\d+<\/span>/)
  for (const m of home.matchAll(/data-chip="(\d)">[^<]+<span class="pill-n">(\d+)<\/span>/g)) assert.ok(Number(m[2]) > 0, `chip ${m[1]} has guides`)
  // Start here: the newest guide, featured with the story log; the others numbered from 02.
  assert.match(home, /Start here[\s\S]*?<article class="gc rv is-feature" data-search="[^"]*" data-topic="\d">\s*<div class="storylog"/)
  assert.match(home, /<span class="gc-n">01<\/span>/)
  assert.match(home, /<span class="gc-n">02<\/span>/)
  // The prompt strip replaces the big closing band on the home page; the llms.txt card links the blog's own.
  assert.match(home, /<section class="strip rv" aria-labelledby="strip-title">/)
  assert.ok(!home.includes('id="cta-title"'), 'no second closing band')
  assert.match(home, /<a class="pill" href="\/llms\.txt">llms\.txt<\/a>/)
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

test('the post shell: Guide label, scene, takeaways.log, numbered chapters with rail and bar, end strip, Your turn', () => {
  const html = read(dist, EVERY)
  assert.match(html, /<nav aria-label="Breadcrumb" class="gp-crumbs"><a href="\/">Guides<\/a>/)
  assert.match(html, /<span class="tag-lime">Guide<\/span>/)
  // The scene: four moments, all visible in the HTML (lit by a script only when it runs).
  assert.equal(count(html, /<div class="scene-m" data-m="/g), 4)
  // takeaways.log replaces the TL;DR box.
  assert.match(html, /<section class="filecard tk" aria-labelledby="tldr-title">/)
  assert.ok(!html.includes('rounded-2xl border border-line bg-bg-warm'), 'no old TL;DR box')
  // Chapters: the rail's status (default story states) and contents; the bar for narrow screens works without JS.
  const rail = html.match(/<aside class="rail"[\s\S]*?<\/aside>/)[0]
  assert.deepEqual([...rail.matchAll(/class="status-s" data-state="([a-z]+)"/g)].map((m) => m[1]), ['waiting', 'ringing', 'approved', 'continuing'])
  const states = [...rail.matchAll(/data-ch="[^"]+" data-state="([a-z]+)"/g)].map((m) => m[1])
  assert.ok(states.length >= 4 && states[0] === 'waiting' && states.at(-1) === 'continuing', states.join())
  assert.match(html, /<details class="gbar">[\s\S]*?<ol class="toc">/)
  assert.match(html, /<a class="stuck" href="#[^"]+">Stuck\?/)
  assert.match(html, /<div class="gp-body">/)
  // The end: meta strip with the questions count, Your turn (no second closing band), share.
  assert.match(html, /<dt class="mono-k">Questions answered<\/dt><dd class="endmeta-v" data-questions>\d+<\/dd>/)
  assert.match(html, /<section class="strip rv" aria-labelledby="your-turn">/)
  assert.ok(!html.includes('id="cta-title"'))
  // A post with very few H2s still renders (no contents card, no bar).
  assert.match(read(dist, 'posts/fixture-indexed-post/index.html'), /<aside class="rail"/)
})

test('motion is progressive: content is never hidden in the HTML, and reduced motion turns it off', () => {
  const css = files(join(dist, '_astro')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(css, /\.rv-on \.rv:not\(\.is-in\)\{opacity:0/)
  assert.match(css, /prefers-reduced-motion:\s?reduce\)\{[^@]*\.rv-on \.rv:not\(\.is-in\)\{opacity:1/)
  for (const p of [EVERY, 'index.html']) assert.ok(!read(dist, p).includes('rv-on'), `${p}: the hiding class is only added by the script`)
})

// ---------- Phase 10, Part B: guides ----------

const GUIDE = 'posts/fixture-guide-post/index.html'

test('a guide renders its chapters and every component, in order, with the accent and the example scene', () => {
  const html = read(dist, GUIDE)
  assert.match(html, /<div class="guide" data-guide="6">/)
  assert.match(html, /<h1 class="gp-h1">Fixture: how to make your AI agent <span class="acc">ask before<\/span> it refunds a customer<\/h1>/)
  // Chapter labels and headings (ids for links and the rail)
  assert.match(html, /<p class="gch-k" aria-hidden="true">01 — The problem<\/p>\s*<h2 class="gch-h" id="why-a-refund-needs-a-person">Why a refund needs a person<\/h2>/)
  const order = [...html.matchAll(/data-gc="([a-z_]+)" data-gc-id="(g[\w-]+)"/g)].map((m) => `${m[1]}:${m[2]}`)
  assert.deepEqual(order, ['journey_steps:g2', 'route_compare:g6', 'approve_demo:g7', 'steps_checklist:g9', 'tool_picker:g10', 'file_card:g10-http', 'file_card:g11', 'troubleshooting_picker:g12'])
  assert.match(html, /data-block="phone_ring_sim" data-block-id="g5"/)
  assert.match(html, /data-block="comparison_table" data-block-id="g3"/)
  assert.match(html, /data-block="faq_accordion" data-block-id="g13"/)
  // Hero scene from guide.hero, marked as an example
  assert.match(html, /<span class="scene-k">1 · Refund agent<\/span>/)
  assert.match(html, /Calling Priya, support lead/)
  assert.match(html, /<figcaption class="scene-ex"><span class="ex-tag">Example<\/span> Names and amounts are made up\.<\/figcaption>/)
  // The rail: the guide's states, each chapter linked to its state; Stuck? goes to the troubleshooting chapter
  const rail = html.match(/<aside class="rail"[\s\S]*?<\/aside>/)[0]
  assert.deepEqual([...rail.matchAll(/class="status-s" data-state="([a-z]+)"/g)].map((m) => m[1]), ['waiting', 'ringing', 'approved', 'continuing'])
  assert.deepEqual([...rail.matchAll(/data-ch="[^"]+" data-state="([a-z]+)"/g)].map((m) => m[1]), ['waiting', 'ringing', 'approved', 'continuing', 'continuing', 'continuing'])
  assert.match(rail, /<a class="stuck" href="#if-something-goes-wrong">/)
  // The end: two FAQ questions; Your turn from the guide
  assert.match(html, /data-questions>2<\/dd>/)
  assert.match(html, /<h2 id="your-turn" class="strip-t mt-2">Let your agent ask before it refunds\.<\/h2>/)
})

test('without JavaScript a guide is complete: every outcome, tool, step and fix is in the HTML; controls are js-only', () => {
  const html = read(dist, GUIDE)
  // approve_demo: both outcomes with their labels; the buttons need JS
  assert.match(html, /<div class="demo-btns js-only" role="group"/)
  assert.match(html, /If you approve:[\s\S]*The agent sends the refund and logs who approved it\./)
  assert.match(html, /If you reject:[\s\S]*The agent does not refund/)
  assert.match(html, /<p class="demo-top"><span class="demo-app">M91 · decision needed<\/span><span class="ex-tag">Example<\/span>/)
  // tool_picker: every tool's panel, each named; the picker needs JS
  assert.equal(count(html, /<div class="tools-panel[^"]*" data-panel="/g), 2)
  assert.match(html, /<div class="tools-pills js-only" role="radiogroup"/)
  assert.match(html, /<span class="mono-k">Built in<\/span> LangGraph/)
  // steps: all three, with "Stuck here?" as native details; tap numbers are js-only, plain numbers otherwise
  assert.equal(count(html, /<li class="gstep" data-step="\d">/g), 3)
  assert.equal(count(html, /<button type="button" class="gstep-num js-only"/g), 3)
  assert.equal(count(html, /<span class="gstep-num no-js-only"/g), 3)
  assert.match(html, /<details class="stuckhint"><summary>Stuck here\?<\/summary>/)
  assert.match(html, /data-key="m91-blog:fixture-guide-post:g9"/)
  // troubleshooting: each problem with cause and fix; the picker and the table need JS
  assert.equal(count(html, /<div class="tlog-item" id="/g), 2)
  assert.match(html, /<div class="tlog-item" id="the-phone-does-not-ring">/)
  assert.match(html, /<details class="tlog-all js-only">/)
  // file card: the whole file is in the page, with what it does; Copy and "Show the full file" need JS
  assert.match(html, /<figcaption class="filecard-tab"><span>approval-request\.json<\/span><button type="button" class="fcard-copy js-only" data-copy>Copy<\/button><\/figcaption>/)
  assert.match(html, /<span class="mono-k">What this does<\/span> Asks one person to approve this refund\./)
  assert.match(html, /<button type="button" class="fcard-more js-only" aria-expanded="false" data-more>Show the full file \(4 lines\)<\/button>/)
  assert.match(html, /<pre class="shiki[^"]*"[^>]*><code>[\s\S]*refund-1182/)
  // route compare: every stop listed; Replay is js-only
  assert.equal(count(html, /<li class="route-stop">/g), 9)
  assert.match(html, /<button type="button" class="pill js-only" data-replay>Replay<\/button>/)
  // journey: "You are here" on the current step
  assert.match(html, /<li class="journey-s is-now" aria-current="step">[\s\S]*?<span class="journey-here">You are here<\/span>/)
})

test('guide scripts: one bundled file per component type, only on guide pages; no inline handlers', () => {
  const html = read(dist, GUIDE)
  const srcs = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !SHELL.test(s))
  for (const name of ['ApproveDemo', 'RouteCompare', 'GuideSteps', 'ToolPicker', 'FileCard', 'TroubleshootLog', 'PhoneRingSim', 'FaqAccordion']) {
    assert.ok(srcs.some((s) => s.includes(`/${name}.astro_`)), name)
  }
  for (const src of srcs) assert.ok(existsSync(join(dist, src)), src)
  assert.ok(!/ on[a-z]+="/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline event handlers')
  const plain = [...read(dist, 'posts/fixture-indexed-post/index.html').matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1])
  assert.ok(!plain.some((s) => /ApproveDemo|ToolPicker|RouteCompare/.test(s)), 'no guide script on a plain post')
})

test('reduced motion: guide animations are off and nothing stays dimmed', () => {
  const css = files(join(dist, '_astro')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n')
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion:\s?reduce\)\{([^@]*)\}/g)].map((m) => m[1]).join('\n')
  assert.match(reduced, /\.routes\.is-armed \.route-stop:not\(\.is-lit\)\{opacity:1\}/)
  assert.match(reduced, /\.js \.scene\.is-armed \.scene-m:not\(\.is-lit\)\{opacity:1\}/)
  assert.match(reduced, /animation:none/)
})

test('an invalid guide is dropped with a warning: the post shows its Markdown in the same shell', () => {
  assert.match(built.output, /\[guide\] fixture-invalid-guide-post\.json: guide not valid, showing the post without it/)
  const html = read(dist, 'posts/fixture-invalid-guide-post/index.html')
  assert.ok(!html.includes('class="guide"'))
  assert.match(html, /The guide is dropped: this Markdown is shown\./)
  assert.match(html, /<aside class="rail"/)
})

test('the sample guide is valid, uses every component and builds without warnings', async () => {
  const { validatePost, GUIDE_COMPONENT_TYPES } = await import('@m91/content')
  const sample = JSON.parse(readFileSync(join(root, 'samples', 'sample-guide-refund-approval.json'), 'utf8'))
  assert.deepEqual(validatePost(sample), { valid: true, errors: [] })
  assert.deepEqual([...new Set(sample.guide.chapters.flatMap((c) => c.components.map((x) => x.type)))].sort(), [...GUIDE_COMPONENT_TYPES].sort())
  assert.ok(!/\[guide\] fixture-guide-post/.test(built.output))
})

test('Phase 10 D1: a page preview builds under /preview/<brief_id>/, every page noindex with a Preview badge, no sitemap', () => {
  const content = join(tmp, 'content-preview')
  mkdirSync(content, { recursive: true })
  cpSync(join(root, 'test', 'fixtures', 'posts', 'fixture-guide-post.json'), join(content, 'fixture-guide-post.json'))
  const out = join(tmp, 'dist-preview')
  const r = build(content, out, { BLOG_PREVIEW_BASE: '/preview/261021-0937-JHTR/' })
  assert.equal(r.code, 0, r.output.slice(-1500))
  const html = read(out, 'posts/fixture-guide-post/index.html')
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/)
  assert.match(html, /data-preview-badge>Preview · not published</)
  const srcs = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1])
  assert.ok(srcs.length > 3)
  assert.deepEqual(srcs.filter((u) => !u.startsWith('/preview/261021-0937-JHTR/')), [], 'every local link and asset is under the preview path')
  assert.ok(!existsSync(join(out, 'sitemap-index.xml')), 'no sitemap')
  assert.match(read(out, 'index.html'), /<meta name="robots" content="noindex, nofollow">/)
  const bad = build(content, join(tmp, 'dist-bad'), { BLOG_PREVIEW_BASE: '/elsewhere/' })
  assert.notEqual(bad.code, 0)
  assert.match(bad.output, /BLOG_PREVIEW_BASE must look like \/preview\/<brief_id>\//)
})
