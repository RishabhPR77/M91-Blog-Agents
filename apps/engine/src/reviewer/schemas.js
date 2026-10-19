// The Reviewer's strict JSON schema — exact shape from the Phase 5 brief, B4.

import Ajv from 'ajv'

export const GATE_IDS = Object.freeze(['m91_claims_correct', 'claims_to_avoid_respected', 'no_invented_content', 'sources_support_claims', 'story_attribution_correct', 'tutorial_traceable', 'answers_main_question', 'no_legal_advice_framing'])
export const AREA_IDS = Object.freeze(['answers_question', 'simplicity', 'accuracy', 'seo', 'structure', 'tone', 'originality', 'ai_answer_readiness', 'to_the_point', 'm91_fit_cta'])
export const VERDICTS = Object.freeze(['supports', 'contradicts', 'unclear', 'could_not_open'])

const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const str = { type: 'string' }
const arr = (items) => ({ type: 'array', items })

export const reviewer_result = {
  name: 'reviewer_result',
  strict: true,
  schema: obj({
    gates: arr(obj({ id: { type: 'string', enum: [...GATE_IDS] }, passed: { type: 'boolean' }, evidence: str })),
    areas: arr(obj({ id: { type: 'string', enum: [...AREA_IDS] }, score: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, evidence: str })),
    feedback: arr(obj({
      area: str,
      quote: str,
      problem: str,
      fix: str,
      severity: { type: 'string', enum: ['must', 'should'] },
      send_to: { type: 'string', enum: ['writer', 'strategist', 'scout'] },
      claims: arr(str)
    })),
    fixed_previous: arr(obj({ previous_quote: str, fixed: { type: 'boolean' }, note: str })),
    sources_checked: arr(obj({ url: str, claim: str, verdict: { type: 'string', enum: [...VERDICTS] } })),
    lessons: arr(str),
    summary: str
  })
}

const validate = new Ajv({ allErrors: true, strict: false }).compile(reviewer_result.schema)

/**
 * Problems with a parsed answer ([] when usable): schema errors, then exactly one entry per gate id
 * and per area id (B4; checked in code because a JSON schema cannot say it).
 */
export function reviewSchemaErrors(value) {
  if (!value || typeof value !== 'object') return ['/ the answer is not a JSON object']
  if (!validate(value)) return validate.errors.slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}`)
  const problems = []
  for (const [list, ids, what] of [[value.gates, GATE_IDS, 'gate'], [value.areas, AREA_IDS, 'area']]) {
    const seen = list.map((x) => x.id)
    const missing = ids.filter((id) => !seen.includes(id))
    const dupes = [...new Set(seen.filter((id, i) => seen.indexOf(id) !== i))]
    if (missing.length) problems.push(`missing ${what} id(s): ${missing.join(', ')}`)
    if (dupes.length) problems.push(`duplicate ${what} id(s): ${dupes.join(', ')}`)
  }
  return problems
}
