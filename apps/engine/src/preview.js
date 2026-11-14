// Live previews for the run page (2026-11-14): what each agent has just produced, sent as "preview" events to the
// dashboard while a run works. Live only: they are never saved in the run record or in memory (a draft is large), and
// they go through the same secret masking as every event.

const hostOf = (u) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * The findings in any Scout answer, as short lines: every list of objects in it (questions, news, sources, facts,
 * tutorial steps), each item's main text and where it comes from. At most `max` items.
 */
export function previewItems(value, max = 14) {
  const out = []
  const TEXT = ['question', 'title', 'name', 'claim', 'fact', 'what_happened', 'idea', 'step', 'summary']
  const META = ['where', 'outlet', 'publisher', 'source_name', 'demand_evidence']
  const visit = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 2) return
    for (const [key, x] of Object.entries(v)) {
      if (Array.isArray(x) && x.length && x[0] && typeof x[0] === 'object') {
        for (const o of x) {
          if (out.length >= max) return
          const text = TEXT.map((k) => o[k]).find((t) => typeof t === 'string' && t.trim())
          if (!text) continue
          const meta = META.map((k) => o[k]).find((t) => typeof t === 'string' && t.trim()) ?? hostOf(o.source_url ?? o.url) ?? ''
          out.push({ group: key, text: text.trim().slice(0, 220), meta: String(meta).slice(0, 90) })
        }
      } else if (x && typeof x === 'object' && !Array.isArray(x)) visit(x, depth + 1)
    }
  }
  visit(value, 0)
  return out
}
