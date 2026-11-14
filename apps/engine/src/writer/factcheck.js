// The fact check before the review (2026-11-13). Every first review on 2026-11-13 failed on a gate
// (m91_claims_correct, sources_support_claims) for one or two factual slips in a 2,000-word post: the Reviewer was the
// first thing that checked facts. Now the Reviewer's model checks the facts first, against the same evidence (M91
// FACTS, M91 DOCS TEXT, SOURCE TEXT), and the Writer applies the exact fixes in its own thread before the review.
// It never stops a run: a failed or unusable check is a warning.
import { MESSAGE_MAX } from '../scout/prompts.js'
import { quoteFound } from '../reviewer/decide.js'

export const FACT_CHECK = `You check the facts in a blog post about M91 before it is reviewed. Facts only: not style, length or structure.
M91 (by MSG91) rings a person's phone when software, a workflow or an AI agent needs a human decision; the answer returns to the software.

Read every sentence of POST and list each one that:
- says something about M91 (its API, events, callbacks, fields, limits, behaviour) that M91 FACTS and M91 DOCS TEXT do not say, or says it more strongly than they do ("exactly", "every", "always", "only", "never", a count) where they qualify it ("per answer", "up to", "can", "may");
- contradicts M91 FACTS, M91 DOCS TEXT or SOURCE TEXT, or says the docs do not cover something they do cover;
- states an outside fact (a number, a date, who did what, what a report found, how a tool or API behaves) that the page it links to in SOURCE TEXT does not state;
- contradicts another sentence of POST;
- says the software should go ahead after a rejection, a timeout or no answer, or promises something BRIEF claims_to_avoid forbids.
A page marked "could not be loaded" is judged only by what BRIEF says about it. Use only the texts in the message; do not open any page.

For each sentence: "quote" = its exact words from POST (at most 25 words, never paraphrased); "problem" = one short sentence; "fix" = the corrected sentence, true to the sources, or "remove" when nothing true can replace it.
Return {"issues": []} when every claim is supported. Return ONLY JSON that matches the schema.`

export const fact_check = {
  name: 'fact_check',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['issues'],
    properties: {
      issues: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['quote', 'problem', 'fix'], properties: { quote: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } }
      }
    }
  }
}

/** The fact check's message: the post and the evidence, cut to fit (the source pages first, then the docs text). */
export function factCheckMessage({ post, facts, docsText, sourceText, brief }, max = MESSAGE_MAX) {
  const sec = { post, facts, brief, docsText, sourceText }
  const order = [['post', 'POST'], ['facts', 'M91 FACTS'], ['brief', 'BRIEF'], ['docsText', 'M91 DOCS TEXT'], ['sourceText', 'SOURCE TEXT']]
  const build = () => order.filter(([k]) => sec[k]).map(([k, label]) => `--- ${label} ---\n${sec[k]}`).join('\n')
  let message = build()
  for (const key of ['sourceText', 'docsText']) {
    if (message.length <= max || !sec[key]) continue
    const keep = sec[key].length - (message.length - max) - 50
    sec[key] = keep > 500 ? `${sec[key].slice(0, keep)} …(trimmed)` : null
    message = build()
  }
  return message.length <= max ? message : null
}

/** The usable issues of an answer: quotes that are really in the post, each once. */
export function factIssues(content, post) {
  let v = content
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || !Array.isArray(v.issues)) return null
  const seen = new Set()
  return v.issues.filter((x) => {
    if (!x || typeof x.quote !== 'string' || typeof x.fix !== 'string' || !x.quote.trim()) return false
    const key = x.quote.trim().toLowerCase()
    if (seen.has(key) || !quoteFound(post, x.quote)) return false
    seen.add(key)
    return true
  })
}

/** One line per issue for the Writer: the sentence, what is wrong, and the corrected sentence. */
export const factFixLine = (x) => `"${x.quote.trim()}": ${String(x.problem ?? '').trim()} Write instead: ${x.fix.trim() === 'remove' ? '(remove this sentence)' : `"${x.fix.trim()}"`}`
