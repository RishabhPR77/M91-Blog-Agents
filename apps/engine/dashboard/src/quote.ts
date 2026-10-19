// "Quote selected text": the user selects words in the rendered preview; the counter prompt must carry the
// exact text as it appears in the Markdown source. The rendered text has no Markdown markup, so the
// selection is matched against the source allowing only inline markup between characters (emphasis, code
// ticks, strike-through, link brackets with their URL) and any whitespace for a space. Anything else
// (a heading or list marker between paragraphs, an escaped character) is refused with a clear message.

export const QUOTE_MAX_CHARS = 500
export const NO_MATCH_MESSAGE = "Couldn't match this exactly, select a shorter phrase."

const GAP = '(?:[*_`~]|\\[|\\]\\([^)\\s]*\\))*'
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The exact Markdown source text for a selection in the preview, or null when it can't be matched. */
export function findExactQuote(markdown: string, selection: string): string | null {
  const sel = selection.replace(/\s+/g, ' ').trim()
  if (!sel || sel.length > QUOTE_MAX_CHARS) return null
  if (markdown.includes(sel)) return sel
  const tokens = [...sel].map((c) => (c === ' ' ? '\\s+' : escape(c)))
  let re: RegExp
  try {
    re = new RegExp(tokens.join(GAP))
  } catch {
    return null
  }
  const m = re.exec(markdown)
  if (!m) return null
  // Never return a "quote" that starts or ends inside markup the user didn't select.
  return m[0].trim()
}
