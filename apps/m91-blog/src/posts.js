// The posts, read from the engine (GET /api/public/posts and /api/public/posts/<slug>) and kept for a short time.
// A reader never waits on a slow engine twice: one refresh at a time, and when the engine cannot be reached the
// last good copy is served. Only slugs in the list are ever fetched, so made-up URLs cost the engine nothing.

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export class EngineError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EngineError'
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const IMAGE_PATH_RE = /^\/images\/[a-f0-9]{20}\.(?:png|jpg|gif|webp)$/
/** A cover: an uploaded image (/images/<name>) or an https address, else null. */
export function cleanCover(v) {
  const c = str(v)
  if (IMAGE_PATH_RE.test(c)) return c
  try {
    return c && new URL(c).protocol === 'https:' ? new URL(c).href : null
  } catch {
    return null
  }
}

/** A post from the engine, checked field by field (anything unexpected is dropped, never shown). */
export function cleanPost(p, { withBody = false } = {}) {
  if (!p || typeof p !== 'object') return null
  const slug = str(p.slug)
  const title = str(p.title)
  if (!SLUG_RE.test(slug) || !title) return null
  const post = {
    slug,
    title,
    description: str(p.description),
    topic: str(p.topic) || null,
    tags: Array.isArray(p.tags) ? p.tags.map(str).filter(Boolean).slice(0, 12) : [],
    date: DAY_RE.test(str(p.date)) ? str(p.date) : null,
    updated_at: str(p.updated_at) || null,
    reading_minutes: Number.isInteger(p.reading_minutes) && p.reading_minutes > 0 ? p.reading_minutes : 1,
    cover: cleanCover(p.cover)
  }
  if (withBody) {
    const markdown = typeof p.markdown === 'string' ? p.markdown : ''
    if (!markdown.trim()) return null
    post.markdown = markdown
  }
  return post
}

export function createPostSource({ engineUrl, freshMs = 60000, timeoutMs = 8000, fetchImpl = globalThis.fetch, now = Date.now, onStale = () => {} }) {
  const cache = new Map()

  async function getJson(path) {
    let res
    try {
      res = await fetchImpl(`${engineUrl}${path}`, { headers: { accept: 'application/json', 'user-agent': 'm91-blog' }, signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      throw new EngineError(`the engine could not be reached (${error.name === 'TimeoutError' ? 'timed out' : error.message})`)
    }
    if (res.status === 404) return null
    if (!res.ok) throw new EngineError(`the engine answered ${res.status}`)
    try {
      return await res.json()
    } catch {
      throw new EngineError('the engine sent something that is not JSON')
    }
  }

  async function cached(key, load) {
    let e = cache.get(key)
    if (e?.has && now() - e.at < freshMs) return e.value
    if (!e) {
      e = { at: 0, value: undefined, has: false, pending: null }
      cache.set(key, e)
    }
    if (!e.pending) {
      const entry = e
      entry.pending = load()
        .then((value) => {
          Object.assign(entry, { at: now(), value, has: true })
          return value
        })
        .finally(() => { entry.pending = null })
    }
    try {
      return await e.pending
    } catch (error) {
      if (e.has) {
        onStale(key, error)
        return e.value
      }
      throw error
    }
  }

  /** Every post (no bodies), newest first. */
  const list = () => cached('list', async () => {
    const body = await getJson('/api/public/posts')
    if (!body || !Array.isArray(body.posts)) throw new EngineError('the engine sent no post list')
    return body.posts.map((p) => cleanPost(p)).filter(Boolean)
  })

  /** One post with its Markdown, or null when there is no such post. */
  async function get(slug) {
    if (!SLUG_RE.test(String(slug ?? ''))) return null
    if (!(await list()).some((p) => p.slug === slug)) return null
    return cached(`post:${slug}`, async () => {
      const body = await getJson(`/api/public/posts/${slug}`)
      return body ? cleanPost(body.post, { withBody: true }) : null
    })
  }

  return { list, get }
}
