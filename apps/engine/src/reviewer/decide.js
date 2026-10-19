// What the code does with the Reviewer's answer (Phase 5 brief, B6). The code — not the AI —
// adds the code gates, checks the quotes, computes the total and decides pass or fail.

import { hardProblems } from '../checks/content.js'
import { GATE_IDS, AREA_IDS } from './schemas.js'

export const WEIGHTS = Object.freeze({
  answers_question: 15, simplicity: 15, accuracy: 15, seo: 10, structure: 10,
  tone: 10, originality: 10, ai_answer_readiness: 5, to_the_point: 5, m91_fit_cta: 5
})

export const CODE_GATE_IDS = Object.freeze(['checks_hard_passed', 'sources_contradicted'])

/** Text as a reader sees it: no link markup, emphasis or code ticks; plain quotes; one space; lower case. */
export function plainText(s) {
  return String(s ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Does the quote appear in the post (whitespace, quote marks, Markdown markup and case ignored)? */
export function quoteFound(markdown, quote) {
  const q = plainText(quote).replace(/^["']|["']$/g, '').replace(/\.\.\.|…/g, '').trim()
  if (!q) return false
  return plainText(markdown).includes(q)
}

/** Feedback quotes not found in the post (empty quotes count as not found). */
export function missingQuotes(markdown, feedback) {
  return feedback.filter((f) => !quoteFound(markdown, f.quote)).map((f) => f.quote)
}

/** Σ(score/10 × weight), rounded to 1 decimal. */
export function computeTotal(areas) {
  const sum = areas.reduce((acc, a) => acc + (Number(a.score) / 10) * (WEIGHTS[a.id] ?? 0), 0)
  return Math.round(sum * 10) / 10
}

/** B6.5: every gate (AI and code) passed AND total ≥ PASS_SCORE_MIN AND every area ≥ PASS_AREA_MIN. */
export function passRule({ gates, areas, total }, { passScoreMin, passAreaMin }) {
  return gates.every((g) => g.passed) && total >= passScoreMin && areas.every((a) => a.score >= passAreaMin)
}

/** The two gates code adds; the AI cannot overrule them. */
export function codeGates({ checkResults = [], sourcesChecked = [] }) {
  const hard = hardProblems(checkResults)
  const contradicted = sourcesChecked.filter((s) => s.verdict === 'contradicts')
  return [
    { id: 'checks_hard_passed', passed: hard.length === 0, evidence: hard.length ? `hard content check(s) failed: ${hard.join(' | ')}` : 'every hard content check passed', source: 'code' },
    { id: 'sources_contradicted', passed: contradicted.length === 0, evidence: contradicted.length ? `source(s) contradict the post: ${contradicted.map((s) => `${s.url} — ${s.claim}`).join(' | ')}` : 'no checked source contradicts the post', source: 'code' }
  ]
}

/**
 * Applies B6.2–B6.6 to a valid answer.
 * @param {object} answer   the parsed reviewer_result
 * @param {object} ctx      { markdown, checkResults, allowedUrls (Set of urlKeys), urlKey, config }
 * @returns {{ gates, areas, total, pass, feedback, fixed_previous, sources_checked, lessons, summary, route_hint, warnings[] }}
 */
export function decide(answer, { markdown, checkResults = [], allowedUrls = null, urlKey = (u) => u, config }) {
  const warnings = []
  const { passAreaMin } = config.gates
  const aiGates = GATE_IDS.map((id) => ({ ...answer.gates.find((g) => g.id === id), source: 'ai' }))
  const areas = AREA_IDS.map((id) => answer.areas.find((a) => a.id === id))
  const sources = answer.sources_checked ?? []

  // Web use can only be limited by the prompt (viaSocket's web access is always on): check it afterwards.
  if (allowedUrls) {
    const outside = sources.filter((s) => !allowedUrls.has(urlKey(s.url)))
    if (outside.length) warnings.push(`Reviewer checked URL(s) outside ALLOWED URLS: ${outside.map((s) => s.url).join(', ')}`)
  }
  const max = config.reviewer.maxSourceChecks
  if (sources.length > max) warnings.push(`Reviewer checked ${sources.length} sources; REVIEWER_MAX_SOURCE_CHECKS is ${max}`)

  const gates = [...aiGates, ...codeGates({ checkResults, sourcesChecked: sources })]
  const total = computeTotal(areas)
  const failedGates = gates.filter((g) => !g.passed)
  const lowAreas = areas.filter((a) => a.score < passAreaMin)
  const pass = passRule({ gates, areas, total }, config.gates)

  // B6.3: every quote must exist in the post (kept either way, marked).
  let feedback = (answer.feedback ?? []).map((f) => ({ ...f, claims: f.send_to === 'scout' ? f.claims ?? [] : [], quote_found: quoteFound(markdown, f.quote) }))
  const notFound = feedback.filter((f) => !f.quote_found)
  if (notFound.length) warnings.push(`${notFound.length} feedback quote(s) not found in the post: ${notFound.map((f) => `"${String(f.quote).slice(0, 60)}"`).join(', ')}`)

  // B6.6 consistency rules.
  if (!pass && !feedback.some((f) => f.severity === 'must') && (failedGates.length || lowAreas.length)) {
    for (const g of failedGates) feedback.push({ area: g.id, quote: '', problem: g.evidence, fix: `Fix what makes the ${g.id} gate fail.`, severity: 'must', send_to: 'writer', claims: [], quote_found: false, generated: true })
    for (const a of lowAreas) feedback.push({ area: a.id, quote: '', problem: a.evidence, fix: `Raise ${a.id} to at least ${passAreaMin}/10.`, severity: 'must', send_to: 'writer', claims: [], quote_found: false, generated: true })
    warnings.push('the review failed without a "must" item: generic "must" items added from the gate/area evidence')
  }
  if (pass && feedback.some((f) => f.severity === 'must')) {
    feedback = feedback.map((f) => (f.severity === 'must' ? { ...f, severity: 'should', downgraded: true } : f))
    warnings.push('the review passed with "must" items: downgraded to "should"')
  }
  feedback.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'must' ? -1 : 1))

  const must = feedback.filter((f) => f.severity === 'must')
  const route_hint = pass ? null
    : must.some((f) => f.send_to === 'strategist') ? 'strategist'
    : must.some((f) => f.send_to === 'scout' && f.claims.length) ? 'scout'
    : 'writer'

  return {
    gates, areas, total, pass, feedback,
    low_areas: lowAreas.map((a) => a.id),
    fixed_previous: answer.fixed_previous ?? [],
    sources_checked: sources,
    lessons: (answer.lessons ?? []).filter((l) => String(l).trim()).slice(0, config.reviewer.lessonsPerReviewMax),
    summary: answer.summary ?? '',
    route_hint,
    warnings
  }
}

/** One line for events and Slack: "Score 88.5/100 · pass · gates 10/10 · 3 should-fix items". */
export function reviewSummaryLine(r) {
  const gatesPassed = r.gates.filter((g) => g.passed).length
  if (r.pass) {
    const should = r.feedback.filter((f) => f.severity === 'should').length
    return `Score ${r.total}/100 · pass · gates ${gatesPassed}/${r.gates.length} · ${should} should-fix item${should === 1 ? '' : 's'}`
  }
  const low = (r.low_areas ?? []).map((id) => `${id} ${r.areas.find((a) => a.id === id)?.score}`)
  const failed = r.gates.filter((g) => !g.passed).map((g) => g.id)
  return `Score ${r.total}/100 · fail · ${[...failed, ...low].slice(0, 4).join(', ') || 'below PASS_SCORE_MIN'} → ${r.route_hint ?? 'writer'}`
}
