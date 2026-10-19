// Paths of noindex posts (relative to the base path), for the sitemap filter in astro.config.mjs.
import { loadPosts } from './load-posts.mjs'

export function noindexPaths() {
  return loadPosts({ dev: false }).posts.filter((p) => p.noindex).map((p) => `/posts/${p.slug}/`)
}
