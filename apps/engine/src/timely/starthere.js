// The "Start here" line of a timely post: code puts it at the top of the body (the first line after the TL;DR), so
// a reader who arrives from the news finds our first approved post (the Starter). With PUBLISH_TARGET=none there is
// no public URL yet, so it names the Starter post (bold); a link comes once posts have URLs.

export const START_HERE_PREFIX = 'New to M91? Start here:'
export const START_HERE_RE = /^\s*New to M91\? Start here:/i

/** Does this brief get the line? A rapid-response post while the timely lane is on. */
export const needsStartHere = (brief, config) => Boolean(config?.timely?.enabled) && brief?.post_type === 'rapid_response'

/** The Starter post: our first approved post that is not itself a timely post (knowledge map), or null. */
export async function starterPost(store) {
  const known = (await store.getRecords({ type: 'knowledge' })).map((r) => r.payload).filter((k) => k?.title && k.kind !== 'timely')
    .sort((a, b) => String(a.approved_at ?? '').localeCompare(String(b.approved_at ?? '')))
  return known.length ? { title: known[0].title, link: known[0].link ?? null, export_slug: known[0].export_slug ?? null } : null
}

/** The one line: a link when the Starter post has a public URL, else its title in bold. */
export const startHereLine = (starter) => `${START_HERE_PREFIX} ${starter.link ? `[${starter.title}](${starter.link})` : `**${starter.title}**`}.`

/**
 * The post with exactly one Start-here line, right after the TL;DR block (after the H1 when there is no TL;DR).
 * A line the Writer wrote itself is replaced.
 */
export function withStartHere(markdown, starter) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n').filter((l) => !START_HERE_RE.test(l))
  let at = lines.findIndex((l) => /^\s*\*\*TL;DR\*\*\s*:?\s*$/i.test(l) || /^\s*TL;DR:?\s*$/i.test(l))
  if (at >= 0) {
    at++
    while (at < lines.length && !lines[at].trim()) at++
    while (at < lines.length && /^\s*[-*+]\s+\S/.test(lines[at])) at++
  } else {
    const h1 = lines.findIndex((l) => /^#\s+\S/.test(l))
    at = h1 >= 0 ? h1 + 1 : 0
  }
  const out = [...lines.slice(0, at), '', startHereLine(starter), '', ...lines.slice(at)]
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
