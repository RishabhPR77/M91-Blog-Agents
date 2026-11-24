// Posts you write yourself for the M91 blog (2026-11-24): pasted or uploaded Markdown, with images, edited on the
// dashboard's Write page and published to https://m91-blog.embarko.app next to the engine's approved posts.
//
// One 'blog_post' record per post (in Mem0, like the approved posts): { title, slug, description, topic, tags, cover,
// markdown, created_at, updated_at, published_at }, status 'draft' or 'published'. Only published posts are public
// (src/publicposts.js). 0 AI calls.

import { blogOnly } from './export/markdown.js'
import { istIso } from './util/time.js'

export const BLOG_POST_STATUSES = Object.freeze(['draft', 'published'])
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/
export const IMAGE_PATH_RE = /^\/images\/[a-f0-9]{20}\.(?:png|jpg|gif|webp)$/
export const LIMITS = Object.freeze({ title: 200, description: 400, topic: 60, tag: 40, tags: 12, markdown: 100000 })
/** Where the posts are read (apps/m91-blog). */
export const M91_BLOG_URL = 'https://m91-blog.embarko.app'

export class BlogError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'BlogError'
    this.status = status
    this.code = code
  }
}

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** A title as a slug: lower case, letters and digits joined by dashes, at most 80 characters. */
export const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '')

/** The first "# Title" line of the Markdown, or ''. */
export const firstHeading = (markdown) => text(String(markdown ?? '').match(/^#[ \t]+(.+?)[ \t#]*$/m)?.[1] ?? '').replace(/[*_`]/g, '')

/** A cover: an uploaded image (/images/…) or an https address; anything else is dropped. */
export function cleanCover(v) {
  const c = text(v)
  if (!c) return null
  if (IMAGE_PATH_RE.test(c)) return c
  try {
    const u = new URL(c)
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/**
 * The fields of a post from a request body, checked. The title falls back to the Markdown's "# Title", the slug to the
 * title. Throws BlogError(400) with what to fix.
 */
export function cleanFields(body = {}) {
  const markdown = blogOnly(typeof body.markdown === 'string' ? body.markdown : '').replace(/\r\n?/g, '\n').trim()
  if (!markdown) throw new BlogError(400, 'no_markdown', 'the post has no text: paste or upload its Markdown')
  if (markdown.length > LIMITS.markdown) throw new BlogError(400, 'too_long', `the post is longer than ${LIMITS.markdown.toLocaleString('en-US')} characters`)
  const title = text(body.title) || firstHeading(markdown)
  if (!title) throw new BlogError(400, 'no_title', 'the post needs a title (or a "# Title" line at the top)')
  if (title.length > LIMITS.title) throw new BlogError(400, 'title_too_long', `the title is longer than ${LIMITS.title} characters`)
  const slug = text(body.slug) || slugify(title)
  if (!SLUG_RE.test(slug)) throw new BlogError(400, 'bad_slug', 'the web address may only use lower-case letters, digits and dashes (not at the start or end)')
  const description = text(body.description)
  if (description.length > LIMITS.description) throw new BlogError(400, 'description_too_long', `the description is longer than ${LIMITS.description} characters`)
  const topic = text(body.topic)
  if (topic.length > LIMITS.topic) throw new BlogError(400, 'topic_too_long', `the topic is longer than ${LIMITS.topic} characters`)
  const rawTags = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(',') : []
  const tags = [...new Set(rawTags.map(text).filter(Boolean))]
  if (tags.length > LIMITS.tags || tags.some((t) => t.length > LIMITS.tag)) throw new BlogError(400, 'bad_tags', `at most ${LIMITS.tags} tags of up to ${LIMITS.tag} characters`)
  if (body.cover && !cleanCover(body.cover)) throw new BlogError(400, 'bad_cover', 'the cover must be an uploaded image or an https address')
  return { title, slug, description, topic: topic || null, tags, cover: cleanCover(body.cover), markdown: `${markdown}\n` }
}

/** A record as the dashboard sees it. */
export function postView(r, { withMarkdown = true } = {}) {
  const p = r.payload ?? {}
  return {
    id: r.id,
    status: r.status === 'published' ? 'published' : 'draft',
    title: p.title ?? '',
    slug: p.slug ?? '',
    description: p.description ?? '',
    topic: p.topic ?? null,
    tags: p.tags ?? [],
    cover: p.cover ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    published_at: p.published_at ?? null,
    ...(withMarkdown && { markdown: p.markdown ?? '' })
  }
}

export const listBlogPostRecords = (store) => store.getRecords({ type: 'blog_post' })

/** Your posts, newest change first (no Markdown). */
export async function listBlogPosts(store) {
  return (await listBlogPostRecords(store)).map((r) => postView(r, { withMarkdown: false })).sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}

async function findRecord(store, id) {
  const r = (await listBlogPostRecords(store)).find((x) => x.id === id)
  if (!r) throw new BlogError(404, 'not_found', 'no such post')
  return r
}

export async function getBlogPost(store, id) {
  return postView(await findRecord(store, id))
}

/** Saves a post (new when there is no id). publish: true publishes it, false makes it a draft, undefined keeps it. */
export async function saveBlogPost(store, { id = null, body = {}, takenSlugs = [], now = Date.now } = {}) {
  const fields = cleanFields(body)
  const at = istIso(new Date(now()))
  const mine = await listBlogPostRecords(store)
  const current = id ? mine.find((x) => x.id === id) : null
  if (id && !current) throw new BlogError(404, 'not_found', 'no such post')
  const clash = mine.some((x) => x.id !== id && x.payload?.slug === fields.slug) || takenSlugs.includes(fields.slug)
  if (clash) throw new BlogError(409, 'slug_taken', `another post already uses the address /posts/${fields.slug}: change the title or the address`)
  const wasPublished = current?.status === 'published'
  const publish = body.publish === undefined || body.publish === null ? wasPublished : body.publish === true
  const status = publish ? 'published' : 'draft'
  const payload = {
    ...fields,
    created_at: current?.payload?.created_at ?? at,
    updated_at: at,
    published_at: publish ? (current?.payload?.published_at ?? at) : (current?.payload?.published_at ?? null)
  }
  if (current) {
    await store.updateRecord(current.id, payload, { status, slug: fields.slug }, { known: current })
    return postView({ ...current, status, payload })
  }
  const rec = await store.createRecord({ type: 'blog_post', payload, status, meta: { slug: fields.slug } })
  return postView({ ...rec, status, payload })
}

/** Publishes or unpublishes without changing the text. */
export async function setPublished(store, id, publish, { now = Date.now } = {}) {
  const r = await findRecord(store, id)
  const at = istIso(new Date(now()))
  const payload = { ...r.payload, updated_at: at, published_at: publish ? (r.payload?.published_at ?? at) : (r.payload?.published_at ?? null) }
  const status = publish ? 'published' : 'draft'
  await store.updateRecord(r.id, payload, { status }, { known: r })
  return postView({ ...r, status, payload })
}

export async function deleteBlogPost(store, id) {
  const r = await findRecord(store, id)
  await store.deleteRecord(r.id)
  return { id: r.id, deleted: true }
}
