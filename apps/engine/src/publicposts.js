// The public blog's posts (2026-11-23): every approved post, and every post you wrote and published on the dashboard's
// Write page (2026-11-24, src/blogposts.js), read-only and without a login, for the M91 blog
// (apps/m91-blog, https://m91-blog.embarko.app) and anything else that lists M91's posts, such as the blog cards on
// m91.msg91.com. A post is public once it is approved: its final Markdown export (saved on Approve) is the post.
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

const newestFirst = (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))

/** Every approved post, newest first, one per slug. Reads the draft and export lists (the engine's index caches both). */
export async function listApprovedPosts(store) {
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
    if (!had || String(post.updated_at ?? '') > String(had.updated_at ?? '')) bySlug.set(post.slug, post)
  }
  return [...bySlug.values()].sort(newestFirst)
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
