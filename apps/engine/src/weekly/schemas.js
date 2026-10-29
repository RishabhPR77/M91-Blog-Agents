// The weekly editor's answer: a few candidate posts, each built from this week's real signals, and the one to write.
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const str = { type: 'string' }
const arr = (items) => ({ type: 'array', items })
const score = { type: 'integer', minimum: 1, maximum: 5 }

export const FORMATS = Object.freeze(['tutorial', 'explainer', 'news_analysis', 'comparison', 'checklist'])

export const weekly_editor = {
  name: 'weekly_editor',
  strict: true,
  schema: obj({
    candidates: arr(obj({
      title: str,
      question: str,
      format: { type: 'string', enum: [...FORMATS] },
      angle: str,
      hook_id: str,
      evidence_ids: arr(str),
      why_now: str,
      scores: obj({ demand: score, timeliness: score, m91_fit: score, gap: score, variety: score })
    })),
    choice: { type: 'integer', minimum: 0, maximum: 9 },
    reason: str
  })
}
