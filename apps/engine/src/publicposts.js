// The public blog's posts (2026-11-23): every approved post, and every post you wrote and published on the dashboard's
// Write page (2026-11-24, src/blogposts.js), read-only and without a login, for the M91 blog
// (apps/m91-blog, https://m91-blog.embarko.app) and anything else that lists M91's posts, such as the blog cards on
// m91.msg91.com. An approved post is public once you OK it for the website on the dashboard (2026-11-24): its final
// Markdown export (saved on Approve) is the post, and the export's metadata says where it stands (websiteOf). Exports
// made before that OK existed count as on the website.
//
// Only what a reader sees leaves the engine: the slug, title, description, topic, tags, dates, reading time and the
// post's Markdown. Never a draft, a review, a score, a brief, a record id or anything a run wrote.

import { blogOnly } from './export/markdown.js'
import { cleanCover } from './blogposts.js'

export const PUBLIC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/
const WORDS_PER_MINUTE = 230
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Minutes to read a post (code blocks left out), at least 1. */
export function readingMinutes(markdown) {
  const words = String(markdown ?? '').replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 12) : [])
const text = (v) => (typeof v === 'string' ? v.trim() : '')

/** One export record as a public post, or null when it is not a complete post. */
export function publicPost(rec, { publishedAt = null } = {}) {
  const p = rec?.payload ?? {}
  const fm = p.front_matter ?? {}
  const slug = text(fm.slug) || text(p.slug)
  const title = text(fm.title) || text(p.title)
  const markdown = blogOnly(p.markdown ?? '').trim()
  if (!PUBLIC_SLUG_RE.test(slug) || !title || !markdown) return null
  const exported = text(p.exported_at)
  const day = [text(publishedAt).slice(0, 10), text(fm.date), exported.slice(0, 10)].find((d) => DAY_RE.test(d)) ?? null
  return {
    slug,
    title,
    description: text(fm.description),
    topic: text(fm.topic) || null,
    tags: strings(fm.tags),
    date: day,
    updated_at: exported || null,
    reading_minutes: readingMinutes(markdown),
    cover: null,
    markdown: `${markdown}\n`
  }
}

/** A published post you wrote, as a public post, or null. */
export function writtenPost(rec) {
  if (rec?.status !== 'published') return null
  const p = rec.payload ?? {}
  const slug = text(p.slug)
  const title = text(p.title)
  const markdown = blogOnly(p.markdown ?? '').trim()
  if (!PUBLIC_SLUG_RE.test(slug) || !title || !markdown) return null
  const day = [text(p.published_at).slice(0, 10), text(p.created_at).slice(0, 10)].find((d) => DAY_RE.test(d)) ?? null
  return {
    slug,
    title,
    description: text(p.description),
    topic: text(p.topic) || null,
    tags: strings(p.tags),
    date: day,
    updated_at: text(p.updated_at) || null,
    reading_minutes: readingMinutes(markdown),
    cover: cleanCover(p.cover),
    markdown: `${markdown}\n`
  }
}

/** An approved post's place: 'on' the website, 'waiting' for your OK on the dashboard, or kept 'off'. */
export const WEBSITE_STATES = Object.freeze(['on', 'waiting', 'off'])
export const websiteOf = (rec) => (rec?.metadata?.website === 'waiting' || rec?.metadata?.website === 'off' ? rec.metadata.website : 'on')

const newestFirst = (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))

/**
 * Every approved post, newest first, one per slug, with where it stands: [{ post, brief_id, website }]. For the
 * dashboard and the slug check; the public list keeps only the ones on the website (listApprovedPosts).
 * Reads the draft and export lists (the engine's index caches both).
 */
export async function listEnginePosts(store) {
  // A brief is public when one of its drafts is approved (or was published); the earliest approval is its date.
  const firstApproval = new Map()
  for (const status of ['approved', 'published']) {
    for (const d of await store.getRecords({ type: 'draft', status })) {
      const briefId = d.briefId ?? d.payload?.brief_id
      if (!briefId) continue
      const at = text(d.metadata?.approved_at)
      const had = firstApproval.get(briefId)
      if (had === undefined || (at && (!had || at < had))) firstApproval.set(briefId, at)
    }
  }
  const bySlug = new Map()
  for (const r of await store.getRecords({ type: 'markdown_export' })) {
    const briefId = r.briefId ?? r.payload?.brief_id
    if (!firstApproval.has(briefId)) continue
    const post = publicPost(r, { publishedAt: firstApproval.get(briefId) })
    if (!post) continue
    const had = bySlug.get(post.slug)
    if (!had || String(post.updated_at ?? '') > String(had.post.updated_at ?? '')) bySlug.set(post.slug, { post, brief_id: briefId, website: websiteOf(r) })
  }
  return [...bySlug.values()].sort((a, b) => newestFirst(a.post, b.post))
}

/** The approved posts that are on the website, newest first. */
export async function listApprovedPosts(store) {
  return (await listEnginePosts(store)).filter((e) => e.website === 'on').map((e) => e.post)
}

/** Every approved post and every post you published, newest first, one per slug. */
export async function listPublicPosts(store) {
  const bySlug = new Map((await listApprovedPosts(store)).map((p) => [p.slug, p]))
  // The posts you wrote: a slug the engine already uses stays the engine's (saving such a post is refused anyway).
  for (const r of await store.getRecords({ type: 'blog_post', status: 'published' })) {
    const post = writtenPost(r)
    if (post && !bySlug.has(post.slug)) bySlug.set(post.slug, post)
  }
  return [...bySlug.values()].sort(newestFirst)
}

/** A post without its Markdown, for lists. */
export const postSummary = ({ markdown: _m, ...rest }) => rest
