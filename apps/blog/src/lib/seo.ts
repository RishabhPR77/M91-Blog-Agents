// JSON-LD for posts (BlogPosting + BreadcrumbList) and the home page (Blog).
import type { Post } from './posts'
import { url } from './posts'
import { SITE, SITE_URL, M91_URL } from '../config/site'

const abs = (path: string) => new URL(url(path), SITE_URL).href
const logo = () => abs('/logo.png')

export function blogPostingLd(post: Post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    image: post.seo.og_image,
    url: post.canonical_url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': post.canonical_url },
    author: { '@type': 'Organization', name: SITE.author, url: M91_URL },
    publisher: { '@type': 'Organization', name: SITE.publisher, url: M91_URL, logo: { '@type': 'ImageObject', url: logo() } },
    ...(post.tags.length > 0 && { keywords: post.tags.join(', ') }),
    inLanguage: 'en'
  }
}

export function breadcrumbLd(post: Post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Guides', item: abs('/') },
      { '@type': 'ListItem', position: 2, name: post.title, item: post.canonical_url }
    ]
  }
}

export function blogLd(posts: Post[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: SITE.name,
    description: SITE.description,
    url: abs('/'),
    publisher: { '@type': 'Organization', name: SITE.publisher, url: M91_URL, logo: { '@type': 'ImageObject', url: logo() } },
    blogPost: posts.slice(0, 10).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: p.canonical_url, datePublished: p.published_at }))
  }
}
