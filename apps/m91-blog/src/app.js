// The blog's HTTP handler. Routes:
//   GET /                 every post (?topic=<slug> for one topic)
//   GET /posts/<slug>     one post
//   GET /posts.json       the post list as JSON, for the M91 site's blog cards (any site may read it)
//   GET /images/<name>    an image of a post you wrote, from the engine (kept in memory, never changing)
//   GET /rss.xml · /sitemap.xml · /robots.txt · /favicon.svg · /assets/blog.css · /health
// No cookies, no forms; one script of this site (public/blog.js) adds reading helps. Every answer is read-only.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createPostSource, SLUG_RE, EngineError } from './posts.js'
import { renderPost } from './markdown.js'
import { indexPage, postPage, messagePage, LOGO_SVG, BLOG_TITLE, BLOG_DESCRIPTION, topicSlug } from './pages.js'

const CSS = readFileSync(new URL('../public/blog.css', import.meta.url))
const CSS_PATH = `/assets/blog.css?v=${createHash('sha256').update(CSS).digest('hex').slice(0, 10)}`
const JS = readFileSync(new URL('../public/blog.js', import.meta.url))
const JS_PATH = `/assets/blog.js?v=${createHash('sha256').update(JS).digest('hex').slice(0, 10)}`
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" ${LOGO_SVG.slice(5).replace(' aria-hidden="true"', '').replace(/currentColor/g, '#0B0E12')}`

export const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://m91.msg91.com https://*.msg91.com",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
})

const IMAGE_NAME_RE = /^[a-f0-9]{20}\.(png|jpg|gif|webp)$/
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const IMAGE_CACHE_BYTES = 64 * 1024 * 1024

const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])

export function createApp(cfg, { fetchImpl, now, log = () => {} } = {}) {
  const posts = createPostSource({ engineUrl: cfg.engineUrl, freshMs: cfg.freshMs, timeoutMs: cfg.timeoutMs, fetchImpl, now, onStale: (key, error) => log('warn', 'serving the last copy', { key, error: error.message }) })
  const assets = { css: CSS_PATH, js: JS_PATH }
  // Images by name never change, so a copy is kept (oldest dropped past 64 MB) and browsers keep theirs for a year.
  const images = new Map()
  let imageBytes = 0
  async function image(name) {
    const m = IMAGE_NAME_RE.exec(name)
    if (!m) return null
    if (images.has(name)) return images.get(name)
    let res
    try {
      res = await (fetchImpl ?? globalThis.fetch)(`${cfg.engineUrl}/api/public/images/${name}`, { headers: { 'user-agent': 'm91-blog' }, signal: AbortSignal.timeout(cfg.timeoutMs) })
    } catch (error) {
      throw new EngineError(`the engine could not be reached (${error.message})`)
    }
    if (res.status === 404) return null
    if (!res.ok) throw new EngineError(`the engine answered ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    const img = { body, type: IMAGE_TYPES[m[1]] }
    images.set(name, img)
    imageBytes += body.length
    for (const [k, v] of images) {
      if (imageBytes <= IMAGE_CACHE_BYTES) break
      images.delete(k)
      imageBytes -= v.body.length
    }
    return img
  }

  function reply(req, res, status, type, body, headers = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
    res.writeHead(status, { 'content-type': type, 'content-length': buf.length, ...SECURITY_HEADERS, ...(req.headers['x-forwarded-proto'] === 'https' && { 'strict-transport-security': 'max-age=31536000' }), ...headers })
    res.end(req.method === 'HEAD' ? undefined : buf)
  }
  const html = (req, res, status, body, headers = {}) => reply(req, res, status, 'text/html; charset=utf-8', body, { 'cache-control': status === 200 ? 'public, max-age=60' : 'no-store', ...headers })
  const unavailable = (req, res) => html(req, res, 503, messagePage(cfg, { title: 'The blog is waking up', text: 'The posts could not be loaded just now. Try again in a minute.', assets }), { 'retry-after': '30' })
  const notFound = (req, res) => html(req, res, 404, messagePage(cfg, { title: 'This page is not here', text: 'The post may have moved, or the link has a typo.', assets }))

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(req, res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n', { allow: 'GET, HEAD' })
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      return reply(req, res, 400, 'text/plain; charset=utf-8', 'Bad request\n')
    }
    const path = url.pathname

    if (path === '/health') return reply(req, res, 200, 'application/json', '{"ok":true}', { 'cache-control': 'no-store' })
    if (path === '/assets/blog.css') return reply(req, res, 200, 'text/css; charset=utf-8', CSS, { 'cache-control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300' })
    if (path === '/assets/blog.js') return reply(req, res, 200, 'text/javascript; charset=utf-8', JS, { 'cache-control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300' })
    if (path === '/favicon.svg') return reply(req, res, 200, 'image/svg+xml', FAVICON, { 'cache-control': 'public, max-age=86400' })
    if (path === '/robots.txt') return reply(req, res, 200, 'text/plain; charset=utf-8', `User-agent: *\nAllow: /\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`, { 'cache-control': 'public, max-age=3600' })
    if (path.length > 1 && path.endsWith('/')) {
      res.writeHead(301, { location: path.replace(/\/+$/, '') + url.search, ...SECURITY_HEADERS })
      return res.end()
    }

    try {
      if (path === '/') {
        const all = await posts.list()
        const topic = url.searchParams.get('topic')
        const known = topic && all.some((p) => topicSlug(p.topic) === topic) ? topic : null
        if (topic && !known) return notFound(req, res)
        return html(req, res, 200, indexPage(cfg, { posts: all, topic: known, assets }))
      }
      const m = path.match(/^\/posts\/([^/]+)$/)
      if (m) {
        const slug = m[1]
        if (!SLUG_RE.test(slug)) return notFound(req, res)
        const post = await posts.get(slug)
        if (!post) return notFound(req, res)
        const rendered = renderPost(post.markdown, { siteUrl: cfg.siteUrl })
        const all = await posts.list()
        const others = all.filter((p) => p.slug !== slug)
        const more = [...others.filter((p) => post.topic && p.topic === post.topic), ...others.filter((p) => !post.topic || p.topic !== post.topic)].slice(0, 3)
        return html(req, res, 200, postPage(cfg, { post, rendered, more, assets }))
      }
      if (path.startsWith('/images/')) {
        const img = await image(path.slice('/images/'.length))
        if (!img) return notFound(req, res)
        return reply(req, res, 200, img.type, img.body, { 'cache-control': 'public, max-age=31536000, immutable' })
      }
      if (path === '/posts.json') {
        const all = await posts.list()
        const body = { posts: all.map(({ slug, title, description, topic, date, reading_minutes }) => ({ slug, title, description, topic, date, reading_minutes, url: `${cfg.siteUrl}/posts/${slug}` })) }
        return reply(req, res, 200, 'application/json; charset=utf-8', JSON.stringify(body), { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' })
      }
      if (path === '/rss.xml') {
        const all = await posts.list()
        const items = all.slice(0, 50).map((p) => `<item><title>${xml(p.title)}</title><link>${xml(`${cfg.siteUrl}/posts/${p.slug}`)}</link><guid isPermaLink="true">${xml(`${cfg.siteUrl}/posts/${p.slug}`)}</guid>${p.date ? `<pubDate>${new Date(`${p.date}T09:00:00+05:30`).toUTCString()}</pubDate>` : ''}<description>${xml(p.description)}</description>${p.topic ? `<category>${xml(p.topic)}</category>` : ''}</item>`).join('')
        const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${BLOG_TITLE}</title><link>${xml(cfg.siteUrl)}/</link><description>${xml(BLOG_DESCRIPTION)}</description><language>en</language>${items}</channel></rss>\n`
        return reply(req, res, 200, 'application/rss+xml; charset=utf-8', feed, { 'cache-control': 'public, max-age=300' })
      }
      if (path === '/sitemap.xml') {
        const all = await posts.list()
        const urls = [`<url><loc>${xml(cfg.siteUrl)}/</loc></url>`, ...all.map((p) => `<url><loc>${xml(`${cfg.siteUrl}/posts/${p.slug}`)}</loc>${p.updated_at || p.date ? `<lastmod>${xml(String(p.updated_at || p.date).slice(0, 10))}</lastmod>` : ''}</url>`)]
        return reply(req, res, 200, 'application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`, { 'cache-control': 'public, max-age=300' })
      }
      return notFound(req, res)
    } catch (error) {
      if (error instanceof EngineError) {
        log('warn', 'posts unavailable', { path, error: error.message })
        return unavailable(req, res)
      }
      log('error', 'request failed', { path, error: error.message })
      return html(req, res, 500, messagePage(cfg, { title: 'Something went wrong', text: 'This page could not be shown. Try again in a minute.', assets }))
    }
  }

  return { handle, assets }
}

