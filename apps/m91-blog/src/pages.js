// The pages, as HTML strings: the post list, a post, "not found" and "not available". The look follows
// m91.msg91.com (its colours, system fonts, the M91 mark, the lime blog cards on ruled paper). No script runs on
// any page: the download menu is a <details>, the reading bar is CSS.

import { escapeHtml as e } from './markdown.js'

export const LOGO_SVG = '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true"><polyline points="20,20 44,20 20,20 20,44" stroke="currentColor" stroke-width="13" stroke-linecap="square"/><polyline points="76,20 100,20 100,20 100,44" stroke="currentColor" stroke-width="13" stroke-linecap="square"/><polyline points="20,76 20,100 20,100 44,100" stroke="currentColor" stroke-width="13" stroke-linecap="square"/><polyline points="100,76 100,100 100,100 76,100" stroke="currentColor" stroke-width="13" stroke-linecap="square"/><rect x="45" y="45" width="30" height="30" fill="#D91F26"/></svg>'

const APP_STORE = 'https://apps.apple.com/app/id6759090472'
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=com.msg91.m91'
const ARROW = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const BACK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export const BLOG_TITLE = 'M91 Blog'
export const BLOG_HEADING = 'Notes on waking people up.'
export const BLOG_DESCRIPTION = 'Guides on human-in-the-loop approval, on-call and alerts that get answered, from the team behind M91.'

/** "14 Nov 2026" for a YYYY-MM-DD day. */
export function fmtDay(day) {
  if (!day) return ''
  const d = new Date(`${day}T12:00:00+05:30`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
export const topicSlug = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const minutes = (n) => `${n} min read`
const jsonLd = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

function masthead(cfg) {
  return `<header class="masthead">
  <div class="shell masthead-in">
    <div class="brand">
      <a class="logo" href="${e(cfg.m91Url)}/" aria-label="M91 home"><span class="logo-mark">${LOGO_SVG}</span><span class="logo-word">M91</span></a>
      <span class="brand-sep" aria-hidden="true"></span>
      <a class="brand-blog" href="/">Blog</a>
    </div>
    <nav class="top-actions" aria-label="M91">
      <a class="btn btn-ghost top-back" href="${e(cfg.m91Url)}/">M91 home</a>
      <details class="dl">
        <summary class="btn btn-solid"><span>Download<span class="dl-opt"> the app</span></span></summary>
        <div class="dl-menu">
          <a class="dl-item" href="${APP_STORE}" target="_blank" rel="noopener noreferrer">App Store</a>
          <a class="dl-item" href="${GOOGLE_PLAY}" target="_blank" rel="noopener noreferrer">Google Play</a>
        </div>
      </details>
    </nav>
  </div>
</header>`
}

function footer(cfg) {
  const year = new Date().getFullYear()
  return `<footer class="foot">
  <div class="shell foot-in">
    <a class="foot-l" href="${e(cfg.m91Url)}/" aria-label="M91 home"><span class="foot-mark">${LOGO_SVG}</span><span class="foot-w">M91</span></a>
    <p class="foot-line">Alerts that reach a real human and keep going until somebody answers.</p>
    <div class="foot-bottom">
      <p class="foot-t">${year} M91 · Free forever · Built by <a href="https://msg91.com" target="_blank" rel="noopener noreferrer">MSG91</a></p>
      <nav class="foot-legal" aria-label="Legal">
        <a href="${e(cfg.m91Url)}/docs">Docs</a>
        <a href="https://msg91.com/terms" target="_blank" rel="noopener noreferrer">Terms</a>
        <a href="https://msg91.com/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
        <a href="/rss.xml">RSS</a>
      </nav>
    </div>
  </div>
</footer>`
}

/** The whole document. */
export function layout(cfg, { title, description, path, body, type = 'website', ld = null, noindex = false, assets }) {
  const url = `${cfg.siteUrl}${path}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${e(url)}">`}
<meta property="og:site_name" content="${BLOG_TITLE}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${BLOG_TITLE}" href="/rss.xml">
<link rel="stylesheet" href="${e(assets.css)}">
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
${masthead(cfg)}
<main id="main">
${body}
</main>
${footer(cfg)}
</body>
</html>
`
}

function card(p) {
  return `<a class="bl-card" href="/posts/${e(p.slug)}">
  <span class="bl-k">${e(p.topic ?? 'Guide')}</span>
  <span class="bl-t">${e(p.title)}</span>
  ${p.description ? `<span class="bl-p">${e(p.description)}</span>` : ''}
  <span class="bl-m">${[fmtDay(p.date), minutes(p.reading_minutes)].filter(Boolean).map(e).join(' · ')}</span>
</a>`
}

/** The post list, optionally one topic. */
export function indexPage(cfg, { posts, topic = null, assets }) {
  const topics = [...new Set(posts.map((p) => p.topic).filter(Boolean))].sort()
  const shown = topic ? posts.filter((p) => topicSlug(p.topic) === topic) : posts
  const chip = (label, slug) => {
    const on = (slug ?? null) === (topic ?? null)
    return `<a class="chip${on ? ' is-on' : ''}" href="${slug ? `/?topic=${e(slug)}` : '/'}"${on ? ' aria-current="page"' : ''}>${e(label)}</a>`
  }
  const filters = topics.length > 1 ? `<nav class="chips" aria-label="Topics">${chip('All posts', null)}${topics.map((t) => chip(t, topicSlug(t))).join('')}</nav>` : ''
  const grid = shown.length
    ? `<div class="bl-grid">${shown.map(card).join('\n')}</div>`
    : `<div class="empty"><p class="empty-t">${posts.length ? 'No posts on this topic yet.' : 'The first posts are on their way.'}</p>${posts.length ? '<a class="btn btn-ghost" href="/">See all posts</a>' : `<a class="btn btn-ghost" href="${e(cfg.m91Url)}/">Visit M91</a>`}</div>`
  const body = `<section class="bl" aria-labelledby="blog-h">
  <div class="shell">
    <div class="bl-top">
      <div>
        <p class="eyebrow">Blog</p>
        <h1 class="h2" id="blog-h">${BLOG_HEADING}</h1>
        <p class="sub">${e(BLOG_DESCRIPTION)}</p>
      </div>
      ${filters}
    </div>
    ${grid}
  </div>
</section>`
  const label = topic ? topics.find((t) => topicSlug(t) === topic) : null
  return layout(cfg, {
    title: label ? `${label} · ${BLOG_TITLE}` : `${BLOG_TITLE}: ${BLOG_HEADING.replace(/\.$/, '')}`,
    description: BLOG_DESCRIPTION,
    path: topic ? `/?topic=${topic}` : '/',
    body,
    noindex: Boolean(topic),
    assets,
    ld: { '@context': 'https://schema.org', '@type': 'Blog', name: BLOG_TITLE, description: BLOG_DESCRIPTION, url: `${cfg.siteUrl}/`, publisher: { '@type': 'Organization', name: 'MSG91', url: 'https://msg91.com' } }
  })
}

/** One post. */
export function postPage(cfg, { post, rendered, more, assets }) {
  const toc = rendered.toc.length > 1
    ? `<nav class="toc" aria-label="On this page"><p class="toc-k">On this page</p><ol>${rendered.toc.map((t) => `<li><a href="#${e(t.id)}">${e(t.text)}</a></li>`).join('')}</ol></nav>`
    : ''
  const when = post.date ? `<time datetime="${e(post.date)}">${e(fmtDay(post.date))}</time>` : ''
  const meta = [when, e(minutes(post.reading_minutes))].filter(Boolean).join('<span aria-hidden="true"> · </span>')
  const body = `<div class="read-bar" aria-hidden="true"></div>
<article class="post">
  <header class="post-head shell">
    <a class="back" href="/">${BACK}All posts</a>
    <p class="eyebrow">${e(post.topic ?? 'Guide')}</p>
    <h1 class="h1">${e(post.title)}</h1>
    ${post.description ? `<p class="sub">${e(post.description)}</p>` : ''}
    <p class="post-meta">${meta}</p>
  </header>
  <div class="shell post-grid">
    <div class="prose">
${rendered.html}
    </div>
    ${toc ? `<aside class="rail">${toc}</aside>` : ''}
  </div>
</article>
${more.length ? `<section class="bl more" aria-labelledby="more-h">
  <div class="shell">
    <div class="bl-top"><h2 class="h3" id="more-h">More from the blog</h2><a class="btn btn-ghost" href="/">All posts ${ARROW}</a></div>
    <div class="bl-grid">${more.map(card).join('\n')}</div>
  </div>
</section>` : ''}`
  return layout(cfg, {
    title: `${post.title} · ${BLOG_TITLE}`,
    description: post.description || BLOG_DESCRIPTION,
    path: `/posts/${post.slug}`,
    type: 'article',
    body,
    assets,
    ld: {
      '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description: post.description || undefined,
      datePublished: post.date || undefined, dateModified: post.updated_at || post.date || undefined, keywords: post.tags.length ? post.tags.join(', ') : undefined,
      mainEntityOfPage: `${cfg.siteUrl}/posts/${post.slug}`, url: `${cfg.siteUrl}/posts/${post.slug}`,
      author: { '@type': 'Organization', name: 'M91', url: `${cfg.m91Url}/` },
      publisher: { '@type': 'Organization', name: 'MSG91', url: 'https://msg91.com' }
    }
  })
}

/** Not found, or the posts cannot be loaded right now. */
export function messagePage(cfg, { title, text, assets }) {
  const body = `<section class="bl msg">
  <div class="shell">
    <p class="eyebrow">Blog</p>
    <h1 class="h2">${e(title)}</h1>
    <p class="sub">${e(text)}</p>
    <p class="msg-actions"><a class="btn btn-solid" href="/">All posts</a><a class="btn btn-ghost" href="${e(cfg.m91Url)}/">M91 home</a></p>
  </div>
</section>`
  return layout(cfg, { title: `${title} · ${BLOG_TITLE}`, description: text, path: '/', body, noindex: true, assets })
}
