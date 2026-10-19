// Typed access to the posts for the pages. Indexed posts are the ones lists, feeds and the sitemap show.
import { loadPosts } from './load-posts.mjs'
import { TOPICS } from '../config/site'

export type Post = {
  slug: string
  title: string
  description: string
  tldr: [string, string, string]
  published_at: string
  updated_at: string
  topic_group: number
  tags: string[]
  reading_time_min: number
  markdown: string
  blocks: { type: string; id: string; data: Record<string, unknown> }[] | null
  seo: { title_tag: string; meta_description: string; og_image: string }
  sources: { url: string; title: string }[]
  related_slugs: string[]
  noindex: boolean
  canonical_url: string
  brief_id: string
  version: number
}

let cache: { posts: Post[]; sample: boolean } | null = null

/** Every post (newest first), including noindex posts; samples only in `astro dev` with no content. */
export function getPosts(): { posts: Post[]; sample: boolean } {
  cache ??= loadPosts({ dev: import.meta.env.DEV }) as { posts: Post[]; sample: boolean }
  return cache
}

export const indexedPosts = (): Post[] => getPosts().posts.filter((p) => !p.noindex)
export const isSample = (): boolean => getPosts().sample

export const topicOf = (post: Pick<Post, 'topic_group'>) => TOPICS.find((t) => t.group === post.topic_group) ?? TOPICS[0]

/** Related posts: related_slugs that exist, else the newest indexed posts in the same topic. Max 3, never itself. */
export function relatedPosts(post: Post): Post[] {
  const all = getPosts().posts
  const listed = post.related_slugs.map((s) => all.find((p) => p.slug === s)).filter((p): p is Post => Boolean(p) && p!.slug !== post.slug)
  const fill = indexedPosts().filter((p) => p.topic_group === post.topic_group && p.slug !== post.slug && !listed.includes(p))
  return [...listed, ...fill].slice(0, 3)
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** A path under the base path: url('/posts/x/') → '/posts/x/' (or '/blog/posts/x/' after a move). */
export const url = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
