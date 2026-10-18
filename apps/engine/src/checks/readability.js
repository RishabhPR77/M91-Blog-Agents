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

/** Sentences: split on . ! ? followed by space or end. Empty pieces dropped. */
export function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0)
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
