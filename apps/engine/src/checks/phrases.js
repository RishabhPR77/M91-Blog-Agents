// Phrase lists for the content checks (Phase 4 brief, 9.1). Edit them here, in one place.
// Matching is case-insensitive and on whole words/phrases.

export const BANNED_PHRASES = Object.freeze([
  "in today's fast-paced world", 'ever-evolving landscape', 'delve', 'leverage', 'seamless', 'robust',
  'game-changer', 'unlock', 'harness', 'elevate', "it's important to note", 'when it comes to',
  'in conclusion', 'imagine this', 'picture this', "let's dive in", 'buckle up', 'without further ado',
  'in this article, we will'
])

export const FIRST_PERSON_PHRASES = Object.freeze([
  "we've seen", 'we have seen', 'we noticed', 'in our experience', 'our customers', 'our team found',
  'at M91 we', 'at M91, we'
])

export const HARD_CLAIM_PATTERNS = Object.freeze([
  'M91 guarantees', 'guaranteed to ring', 'guaranteed to reach', 'works on every phone', 'always breaks through',
  'M91 executes', 'M91 performs the action', 'M91 processes payments', 'M91 carries out'
])

/** A sentence mentioning M91 together with one of these words is listed for the Reviewer (soft). */
export const SOFT_CLAIM_WORDS = Object.freeze(['always', 'never fails', '100%', 'every time', 'instantly'])

export const LEGAL_FRAMING_PHRASES = Object.freeze(['legal advice', 'ensures compliance', 'to comply with', 'regulatory requirement', 'compliance advice'])

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]")

/** A case-insensitive regex for a phrase on word boundaries (apostrophes match ' or ’). */
export function phraseRegex(phrase) {
  const lead = /^\w/.test(phrase) ? '\\b' : ''
  const tail = /\w$/.test(phrase) ? '\\b' : ''
  return new RegExp(`${lead}${escape(phrase)}${tail}`, 'i')
}

/** Phrases from `list` found in `text`. */
export function findPhrases(text, list) {
  return list.filter((p) => phraseRegex(p).test(text))
}
