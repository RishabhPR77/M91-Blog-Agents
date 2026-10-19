// Fixtures for Reviewer tests. All content is made up; nothing touches the network.

import { GATE_IDS, AREA_IDS } from '../../src/reviewer/schemas.js'
import { BRIEF_ID, brief, draftAnswer, GOOD_MD, config as writerConfig } from '../writer/fixtures.js'

export const config = (env = {}) => writerConfig(env)

/** A valid reviewer_result. scores: { area_id: n } overrides (default 9); gates: { gate_id: false } fails one. */
export function reviewAnswer({ scores = {}, gates = {}, feedback = [], sources = [], lessons = [], fixed = [], summary = 'Good post. Polish the intro.' } = {}) {
  return {
    gates: GATE_IDS.map((id) => ({ id, passed: gates[id] ?? true, evidence: `${id} evidence` })),
    areas: AREA_IDS.map((id) => ({ id, score: scores[id] ?? 9, evidence: `${id} evidence` })),
    feedback,
    fixed_previous: fixed,
    sources_checked: sources,
    lessons,
    summary
  }
}

export const item = (over = {}) => ({ area: 'simplicity', quote: 'A ringing phone gets attention fast.', problem: 'p', fix: 'f', severity: 'should', send_to: 'writer', claims: [], ...over })

/** Fake aiSend for the Reviewer: answers is a list used in order (value, Error or fn(opts)). */
export function fakeReviewerAi(answers, { model = 'gpt-5.5' } = {}) {
  const requests = []
  const fn = async (opts) => {
    requests.push(opts)
    let a = answers[Math.min(requests.length - 1, answers.length - 1)]
    if (typeof a === 'function') a = a(opts)
    if (a instanceof Error) throw a
    return { content: structuredClone(a), threadId: opts.threadId, messageId: 'm', finishReason: 'completed', model, ms: 7, delivery: 'rtlayer', recoveredFromHistory: false, parseFixes: [] }
  }
  fn.requests = requests
  return fn
}

/** A saved draft payload as the Writer stores it (hard checks passed unless hardFail). */
export function savedDraft({ version = 1, briefVersion = 1, hardFail = false, revisionNotes = [] } = {}) {
  const d = draftAnswer({ revision_notes: revisionNotes })
  return {
    ...d, brief_id: BRIEF_ID, version, brief_version: briefVersion, word_count: 300, reading: { intro_grade: 5, post_grade: 6 },
    checks: { hard_passed: !hardFail, results: [
      { id: 'cta_exact', passed: true, severity: 'hard', value: 1, detail: 'ok' },
      { id: 'ai_written_code', passed: !hardFail, severity: 'hard', value: hardFail ? 4 : 0, detail: hardFail ? 'code block(s) 1, 2, 3, 4 are not snippets' : 'ok' },
      { id: 'reading_post', passed: true, severity: 'soft', value: 6, detail: 'target grade 8' }
    ] },
    snippets: []
  }
}

export { BRIEF_ID, brief, GOOD_MD }
