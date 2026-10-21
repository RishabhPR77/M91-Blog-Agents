// Guide checks (Phase 10, C3): code, after the Experience Designer. Coverage and the schema are checked in
// build.js; this file checks the text the Designer wrote against "no new facts" (heuristics):
// - numbers, amounts, percentages and durations must appear in the post, the brief's facts, sources or tutorial
//   steps, M91 facts or the snippets — except in example fields (hero, approve_demo), which are made up;
// - URLs and inline code must appear there too (never in example fields);
// - banned phrases, first person, hard M91 claims, absolute promises and anything close to a claim to avoid
//   fail everywhere.

import { BANNED_PHRASES, HARD_CLAIM_PATTERNS, findPhrases } from '../checks/phrases.js'
import { urlKey } from '../checks/content.js'
import { similarity } from '../dedupe.js'

const FIRST_PERSON = /\b(we|we're|we've|we'll|our|ours|us)\b/i
// Promises M91 never makes (the standing claims to avoid), in any wording the Designer might reach for.
const ABSOLUTES = [/\bguarantee[sd]?\b/i, /\bnever miss(es|ed)?\b/i, /\beven (on|in|through) silent\b/i, /\b(always|every time)\b[^.]*\b(ring|rings|reach|reaches|answer|answers|wake|wakes)\b/i, /\b100 ?%/]
const UNIT = '(?:ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|%|percent)'
const NUM = /(?:[₹$€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|%|percent)\b)?/gi
const URL = /https?:\/\/[^\s)\]>"'`]+/gi
const CODE = /`([^`]+)`/g
export const CLAIM_SIMILARITY = 0.6

const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')
const digits = (s) => s.replace(/,/g, '')

/** Everything the Designer may take facts from, as one lower-case text (plus its URLs). */
export function guideCorpus({ draft = {}, brief = {}, facts = null, snippets = [] }) {
  const parts = [
    draft.title, ...(draft.tldr ?? []), draft.post_markdown,
    ...(brief.m91_facts_to_use ?? []).flatMap((f) => [f.fact, f.source_url]),
    ...(brief.sources ?? []).flatMap((s) => [s.url, s.what_it_supports]),
    ...(brief.tutorial?.steps ?? []).flatMap((s) => [s.step, s.source_url]),
    ...(brief.questions ?? []).map((q) => (typeof q === 'string' ? q : JSON.stringify(q))),
    ...(facts?.can ?? []).map((f) => (typeof f === 'string' ? f : JSON.stringify(f))),
    ...(facts?.cannot ?? []).map((f) => (typeof f === 'string' ? f : JSON.stringify(f))),
    ...snippets.map((s) => s.code)
  ]
  const text = norm(parts.filter(Boolean).join('\n'))
  return { text, numbers: digits(text), urls: new Set((text.match(URL) ?? []).map(urlKey)) }
}

/**
 * @param {{ key, field, text, example }[]} authored  from buildGuide
 * @param {{ corpus, claimsToAvoid?: string[] }} ctx
 * @returns {{ key, field, problem }[]}
 */
export function factProblems(authored, { corpus, claimsToAvoid = [] }) {
  const out = []
  for (const a of authored) {
    const add = (problem) => out.push({ key: a.key, field: a.field, problem })
    const text = a.text
    if (!a.example) {
      for (const m of text.match(NUM) ?? []) {
        const n = digits(m.toLowerCase().trim())
        const bare = n.replace(/^[₹$€£]\s?/, '')
        const value = Number(bare.match(/[\d.]+/)?.[0])
        const hasUnit = new RegExp(`\\d\\s?${UNIT}\\b`, 'i').test(n) || /[₹$€£]/.test(n)
        // Small plain counts ("3 steps") are interface text; amounts, durations and large numbers must be sourced.
        if (!hasUnit && value <= 10) continue
        const found = corpus.numbers.includes(n) || corpus.numbers.includes(n.replace(/\s/g, '')) || (!hasUnit && new RegExp(`(^|[^\\d.])${bare.replace('.', '\\.')}([^\\d]|$)`).test(corpus.numbers))
        if (!found) add(`"${m.trim()}" is not in the post, the brief or M91 facts (no new numbers)`)
      }
      for (const m of text.match(CODE) ?? []) {
        const code = norm(m.slice(1, -1))
        if (code && !corpus.text.includes(code)) add(`the code \`${m.slice(1, -1)}\` is not in the post or the snippets (no new code)`)
      }
    }
    for (const u of text.match(URL) ?? []) {
      if (a.example || !corpus.urls.has(urlKey(u))) add(`the URL ${u} is not in the post or the brief${a.example ? ' (example text never has URLs)' : ''}`)
    }
    for (const p of findPhrases(text, BANNED_PHRASES)) add(`banned phrase "${p}"`)
    for (const p of findPhrases(text, HARD_CLAIM_PATTERNS)) add(`claim M91 does not make: "${p}"`)
    if (FIRST_PERSON.test(text)) add(`first person ("${text.match(FIRST_PERSON)[0]}"): write as the guide, not as "we"`)
    for (const re of ABSOLUTES) if (re.test(text)) add(`an absolute promise ("${text.match(re)[0]}"): M91 makes no such promise`)
    if (text.length >= 20) {
      for (const claim of claimsToAvoid) if (similarity(text, claim) >= CLAIM_SIMILARITY) add(`too close to a claim to avoid: "${claim}"`)
    }
  }
  return out
}
