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
  guide?: Guide | null
}

/** Phase 10: the guide document (validated with @m91/content when the post is loaded). */
export type GuideState = 'waiting' | 'ringing' | 'approved' | 'rejected' | 'continuing'
export type GuideComponent = { type: string; id: string; data: Record<string, any> }
export type Guide = {
  version: 1
  title_accent: string
  hero: { example: true; agent: string; request: string; person: string; decision: 'approved' | 'rejected'; result: string }
  status_states: { state: GuideState; chapter: string }[]
  chapters: { id: string; number: number; label: string; heading: string; intro_markdown?: string; components: GuideComponent[] }[]
  your_turn: { title: string }
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

/** "Keep reading": related_slugs that exist, then the newest indexed posts in the same topic, then the newest of
 *  the others. Max 3, never itself. */
export function relatedPosts(post: Post): Post[] {
  const all = getPosts().posts
  const listed = post.related_slugs.map((s) => all.find((p) => p.slug === s)).filter((p): p is Post => Boolean(p) && p!.slug !== post.slug)
  const others = indexedPosts().filter((p) => p.slug !== post.slug && !listed.includes(p))
  const same = others.filter((p) => p.topic_group === post.topic_group)
  return [...listed, ...same, ...others.filter((p) => !same.includes(p))].slice(0, 3)
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** A path under the base path: url('/posts/x/') → '/posts/x/' (or '/blog/posts/x/' after a move). */
export const url = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
/** A page preview built by the engine (Phase 10 D1): every page is noindex and says it is a preview. */
export const isPreview = (): boolean => import.meta.env.BASE_URL.startsWith('/preview/')
