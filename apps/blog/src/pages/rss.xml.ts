// RSS: indexed posts only, newest 50.
import rss from '@astrojs/rss'
import type { APIContext } from 'astro'
import { indexedPosts, url } from '../lib/posts'
import { SITE } from '../config/site'

export function GET(context: APIContext) {
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site!,
    items: indexedPosts().slice(0, 50).map((p) => ({
      title: p.title,
      description: p.description,
      pubDate: new Date(p.published_at),
      link: url(`/posts/${p.slug}/`),
      categories: p.tags
    })),
    customData: '<language>en</language>'
  })
}
