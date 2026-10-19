// llms.txt: what the site is, and the indexed posts (title, URL, description).
import { indexedPosts } from '../lib/posts'
import { SITE, M91_URL } from '../config/site'

export function GET() {
  const lines = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.description}`,
    '',
    `The blog of M91 (${M91_URL}): M91 rings a person's phone through silent mode when software or an AI agent needs a human decision, and sends the answer back.`,
    '',
    '## Posts',
    '',
    ...indexedPosts().map((p) => `- [${p.title}](${p.canonical_url}): ${p.description}`)
  ]
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
