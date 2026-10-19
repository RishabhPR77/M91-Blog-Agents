// Mem0 → apps/blog/src/content/posts (Phase 7 C4 step 3). The folder is regenerated on every publish:
// Mem0 stays the single source of truth.

import { readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/blog, next to apps/engine (the same layout in the repo and in the Docker image). */
export const BLOG_DIR = fileURLToPath(new URL('../../../blog/', import.meta.url))
export const CONTENT_DIR = join(BLOG_DIR, 'src', 'content', 'posts')

/** The posts to export: every published_post with status published or publishing (never unpublished). */
export function postsToExport(records, { extra = [], drop = [] } = {}) {
  const bySlug = new Map()
  for (const r of records) {
    if ((r.status === 'published' || r.status === 'publishing') && r.payload?.post?.slug) bySlug.set(r.payload.post.slug, r.payload.post)
  }
  // DRY_RUN: the post being published exists only in memory (nothing was saved).
  for (const post of extra) bySlug.set(post.slug, post)
  // DRY_RUN unpublish: the post leaves only in memory.
  for (const slug of drop) bySlug.delete(slug)
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Clears the folder's *.json files, then writes one <slug>.json per post. Returns the file names. */
export function writePosts(posts, dir = CONTENT_DIR) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(join(dir, f))
  const written = []
  for (const post of posts) {
    const name = `${post.slug}.json`
    writeFileSync(join(dir, name), JSON.stringify(post, null, 2) + '\n', 'utf8')
    written.push(name)
  }
  return written
}

/** npm run blog:sync and every publish: read Mem0, write the folder. */
export async function exportPublished(store, { dir = CONTENT_DIR, extra = [], drop = [] } = {}) {
  const records = await store.getRecords({ type: 'published_post' })
  const posts = postsToExport(records, { extra, drop })
  return { files: writePosts(posts, dir), posts }
}
