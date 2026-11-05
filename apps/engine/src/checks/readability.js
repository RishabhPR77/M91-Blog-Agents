// Readability (Phase 4 brief, 9.2): Flesch–Kincaid grade on prose, with a vowel-group syllable heuristic.

/** Syllables in one word: vowel groups (a e i o u y), minus a silent final "e", at least 1. */
export function countSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  let count = (w.match(/[aeiouy]+/g) ?? []).length
  // Silent final "e" (make, phone), but not consonant + "le" (table, simple) and not when it is the only vowel group.
  if (w.endsWith('e') && !/[^aeiouy]le$/.test(w) && count > 1) count--
  return Math.max(1, count)
}

/** Words: runs of letters (with inner apostrophes/hyphens), digits count as words too. */
export function words(text) {
  return String(text).match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []
}

/**
 * Sentences: split on . ! ? (and any closing quotes or brackets right after them: `approved.” Then`, `(see below.)
 * Next`) followed by space, and on line breaks. Empty pieces dropped.
 */
export function sentences(text) {
  return String(text)
    .split(/(?<=[.!?][)\]"'”’»]*)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0)
}

/** How hard one sentence is to read: the Flesch–Kincaid terms for that sentence alone. */
export function sentenceDifficulty(sentence) {
  const w = words(sentence)
  if (!w.length) return 0
  return 0.39 * w.length + 11.8 * (w.reduce((n, x) => n + countSyllables(x), 0) / w.length) - 15.59
}

/**
 * What makes a text hard, for the Writer's repair: its hardest sentences (at least 8 words) and the long words
 * (4+ syllables) it uses most.
 */
export function hardestParts(text, { sentencesTop = 5, wordsTop = 8 } = {}) {
  const hard = sentences(text)
    .filter((s) => words(s).length >= 8)
    .map((s) => ({ s, d: sentenceDifficulty(s) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, sentencesTop)
    .map((x) => x.s)
  const counts = new Map()
  for (const w of words(text)) {
    if (countSyllables(w) < 4 || /\d/.test(w)) continue
    const k = w.toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const long = [...counts].sort((a, b) => b[1] - a[1]).slice(0, wordsTop).map(([k, n]) => `${k} (${n}×)`)
  return { sentences: hard, longWords: long }
}

/** Flesch–Kincaid grade, one decimal place; null when there is no prose. */
export function fleschKincaidGrade(text) {
  const w = words(text)
  const s = sentences(text)
  if (!w.length || !s.length) return null
  const syllables = w.reduce((n, x) => n + countSyllables(x), 0)
  const grade = 0.39 * (w.length / s.length) + 11.8 * (syllables / w.length) - 15.59
  return Math.round(grade * 10) / 10
}

/** Average sentence length and the number of sentences over `long` words. */
export function sentenceStats(text, long = 25) {
  const s = sentences(text)
  const lengths = s.map((x) => words(x).length)
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  return { count: s.length, average: Math.round(avg * 10) / 10, over: lengths.filter((n) => n > long).length }
}
