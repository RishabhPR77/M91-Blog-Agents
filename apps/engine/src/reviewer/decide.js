// What the code does with the Reviewer's answer (Phase 5 brief, B6). The code — not the AI —
// adds the code gates, checks the quotes, computes the total and decides pass or fail.

import { majorProblems, minorProblems } from '../checks/content.js'
import { reviewerIds } from './schemas.js'

// Phase 10: experience (10) is new; structure and originality give 5 each (the guide now carries structure).
// Before Phase 10, and whenever EXPERIENCE_ENABLED=false.
// Phase 12: simplicity and to-the-point weigh more (20 and 15); structure (the code checks enforce it), tone and
// originality weigh 5 each. SEO keeps 10. Both variants add up to 100.
export const LEGACY_WEIGHTS = Object.freeze({
  answers_question: 15, simplicity: 20, accuracy: 15, seo: 10, structure: 5,
  tone: 5, originality: 5, ai_answer_readiness: 5, to_the_point: 15, m91_fit_cta: 5
})
/** The area weights for a mode (design: is the Experience Designer on?). */
export const weightsFor = (design = true) => (design ? WEIGHTS : LEGACY_WEIGHTS)

// With the Experience Designer on, experience takes 10 from to_the_point (15 → 10) and seo (10 → 5).
export const WEIGHTS = Object.freeze({
  answers_question: 15, simplicity: 20, accuracy: 15, seo: 5, structure: 5,
  tone: 5, originality: 5, ai_answer_readiness: 5, to_the_point: 10, m91_fit_cta: 5, experience: 10
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
export function computeTotal(areas, weights = WEIGHTS) {
  const sum = areas.reduce((acc, a) => acc + (Number(a.score) / 10) * (weights[a.id] ?? 0), 0)
  return Math.round(sum * 10) / 10
}

/** B6.5: every gate (AI and code) passed AND total ≥ PASS_SCORE_MIN AND every area ≥ PASS_AREA_MIN. */
export function passRule({ gates, areas, total }, { passScoreMin, passAreaMin }) {
  return gates.every((g) => g.passed) && total >= passScoreMin && areas.every((a) => a.score >= passAreaMin)
}

/**
 * The outcome of a review:
 * - pass: every gate passed, no hard check failed, total ≥ PASS_SCORE_MIN, every area ≥ PASS_AREA_MIN;
 * - notes ("pass with notes"): no major problem, but something minor is left (a total from REVISE_BELOW_SCORE up to
 *   PASS_SCORE_MIN, a low area, a minor hard check): the post goes to you, not back to the Writer;
 * - revise: a major problem (an AI gate, a contradicting source, a major hard check) or a total below
 *   REVISE_BELOW_SCORE: the post goes back.
 */
export function outcomeOf({ gates, areas, total, minorChecks = [] }, { passScoreMin, passAreaMin, reviseBelowScore = passScoreMin }) {
  const major = gates.some((g) => !g.passed) || total < reviseBelowScore
  if (major) return 'revise'
  return minorChecks.length === 0 && passRule({ gates, areas, total }, { passScoreMin, passAreaMin }) ? 'pass' : 'notes'
}

/** The two gates code adds; the AI cannot overrule them. checks_hard_passed counts the major hard checks only. */
export function codeGates({ checkResults = [], sourcesChecked = [] }) {
  const hard = majorProblems(checkResults)
  const minor = minorProblems(checkResults)
  const contradicted = sourcesChecked.filter((s) => s.verdict === 'contradicts')
  return [
    { id: 'checks_hard_passed', passed: hard.length === 0, evidence: hard.length ? `hard content check(s) failed: ${hard.join(' | ')}` : minor.length ? `every major hard check passed; minor: ${minor.join(' | ')}` : 'every hard content check passed', source: 'code' },
    { id: 'sources_contradicted', passed: contradicted.length === 0, evidence: contradicted.length ? `source(s) contradict the post: ${contradicted.map((s) => `${s.url} — ${s.claim}`).join(' | ')}` : 'no checked source contradicts the post', source: 'code' }
  ]
}

/**
 * Applies B6.2–B6.6 to a valid answer.
 * @param {object} answer   the parsed reviewer_result
 * @param {object} ctx      { markdown, checkResults, allowedUrls (Set of urlKeys), urlKey, config, guide, guideText }
 *   guide: the guide reviewed (null: none). Without a guide, code sets experience to the structure score and passes
 *   no_new_facts_in_design, so a plain post is scored the same way as before.
 * @returns {{ gates, areas, total, pass, feedback, fixed_previous, sources_checked, lessons, summary, route_hint, warnings[] }}
 */
export function decide(answer, { markdown, checkResults = [], allowedUrls = null, urlKey = (u) => u, config, guide = null, guideText = '' }) {
  const warnings = []
  const { passAreaMin } = config.gates
  // EXPERIENCE_ENABLED=false: the pre-Phase-10 gates, areas and weights.
  const design = config.designer?.enabled !== false
  const ids = reviewerIds(design)
  let aiGates = ids.gates.map((id) => ({ ...answer.gates.find((g) => g.id === id), source: 'ai' }))
  let areas = ids.areas.map((id) => answer.areas.find((a) => a.id === id))
  if (design && !guide) {
    const structure = areas.find((a) => a.id === 'structure')
    areas = areas.map((a) => (a.id === 'experience' ? { id: 'experience', score: structure.score, evidence: 'no guide: scored as structure', source: 'code' } : a))
    aiGates = aiGates.map((g) => (g.id === 'no_new_facts_in_design' ? { id: g.id, passed: true, evidence: 'no guide', source: 'code' } : g))
  }
  // Feedback quotes may come from the post or from the text the Experience Designer wrote.
  const findIn = `${markdown}\n${guideText}`
  // Web use can only be limited by the prompt (viaSocket's web access is always on), so code enforces
  // it afterwards (Phase 5.5 A2): a check of a page outside ALLOWED URLS is dropped, so its verdict can
  // never affect the decision (e.g. the sources_contradicted gate).
  const checked = answer.sources_checked ?? []
  const outside = allowedUrls ? checked.filter((s) => !allowedUrls.has(urlKey(s.url))) : []
  const sources = checked.filter((s) => !outside.includes(s))
  if (outside.length) warnings.push(`dropped ${outside.length} source check(s) of URL(s) outside ALLOWED URLS: ${outside.map((s) => `${s.url} (${s.verdict})`).join(', ')}`)
  const max = config.reviewer.maxSourceChecks
  if (checked.length > max) warnings.push(`Reviewer checked ${checked.length} sources; REVIEWER_MAX_SOURCE_CHECKS is ${max}`)

  const gates = [...aiGates, ...codeGates({ checkResults, sourcesChecked: sources })]
  const total = computeTotal(areas, weightsFor(design))
  const failedGates = gates.filter((g) => !g.passed)
  const lowAreas = areas.filter((a) => a.score < passAreaMin)
  const minorChecks = minorProblems(checkResults)
  const outcome = outcomeOf({ gates, areas, total, minorChecks }, config.gates)
  // "Pass with notes" counts as a pass: the post goes to you for approval, the minor items listed as "should".
  const pass = outcome !== 'revise'

  // B6.3: every quote must exist in the post (kept either way, marked).
  let feedback = (answer.feedback ?? []).map((f) => ({ ...f, claims: f.send_to === 'scout' ? f.claims ?? [] : [], quote_found: quoteFound(findIn, f.quote) }))
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
    warnings.push(`the review ${outcome === 'notes' ? 'passed with notes' : 'passed'} with "must" items: downgraded to "should"`)
  }
  // Pass with notes: the minor hard checks and the low areas are listed for you (they did not call the Writer).
  if (outcome === 'notes') {
    for (const m of minorChecks) feedback.push({ area: 'checks', quote: '', problem: m, fix: 'Minor: fix it by hand or with Request changes if it matters.', severity: 'should', send_to: 'writer', claims: [], quote_found: false, generated: true })
    for (const a of lowAreas) if (!feedback.some((f) => f.area === a.id)) feedback.push({ area: a.id, quote: '', problem: `${a.id} ${a.score}/10: ${a.evidence}`, fix: 'Minor: improve it with Request changes if it matters.', severity: 'should', send_to: 'writer', claims: [], quote_found: false, generated: true })
  }
  feedback.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'must' ? -1 : 1))

  const must = feedback.filter((f) => f.severity === 'must')
  const route_hint = pass ? null
    : must.some((f) => f.send_to === 'strategist') ? 'strategist'
    : must.some((f) => f.send_to === 'scout' && f.claims.length) ? 'scout'
    : must.length && must.every((f) => f.send_to === 'designer') ? 'designer'
    : 'writer'

  return {
    gates, areas, total, pass, outcome, feedback,
    low_areas: lowAreas.map((a) => a.id),
    fixed_previous: answer.fixed_previous ?? [],
    sources_checked: sources,
    lessons: (answer.lessons ?? []).filter((l) => String(l).trim()).slice(0, config.reviewer.lessonsPerReviewMax),
    summary: answer.summary ?? '',
    route_hint,
    warnings
  }
}

/** One line for events and Slack: "Score 88.5/100 · pass · gates 11/11 · 3 should-fix items". */
export function reviewSummaryLine(r) {
  const gatesPassed = r.gates.filter((g) => g.passed).length
  if (r.pass) {
    const should = r.feedback.filter((f) => f.severity === 'should').length
    return `Score ${r.total}/100 · ${r.outcome === 'notes' ? 'pass with notes' : 'pass'} · gates ${gatesPassed}/${r.gates.length} · ${should} should-fix item${should === 1 ? '' : 's'}`
  }
  const low = (r.low_areas ?? []).map((id) => `${id} ${r.areas.find((a) => a.id === id)?.score}`)
  const failed = r.gates.filter((g) => !g.passed).map((g) => g.id)
  return `Score ${r.total}/100 · fail · ${[...failed, ...low].slice(0, 4).join(', ') || 'below PASS_SCORE_MIN'} → ${r.route_hint ?? 'writer'}`
}
