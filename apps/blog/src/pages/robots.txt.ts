// robots.txt: allow all; point to the sitemap.
import { SITE_URL } from '../config/site'
import { url } from '../lib/posts'

export function GET() {
  const sitemap = new URL(url('/sitemap-index.xml'), SITE_URL).href
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
