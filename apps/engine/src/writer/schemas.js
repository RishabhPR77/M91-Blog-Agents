// The Writer's strict JSON schema — exact shape from the Phase 4 brief, section 7.

import Ajv from 'ajv'

const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const str = { type: 'string' }
const arr = (items) => ({ type: 'array', items })

export const writer_draft = {
  name: 'writer_draft',
  strict: true,
  schema: obj({
    title: str,
    post_markdown: str,
    tldr: arr(str),
    seo: obj({
      title_tag: str,
      meta_description: str,
      slug_suggestion: str,
      image_ideas: arr(obj({ description: str, alt_text: str }))
    }),
    context: obj({
      summary: str,
      key_points: arr(str),
      structure: arr(str),
      m91_facts_used: arr(str),
      sources_used: arr(str),
      story_used: str,
      open_issues: arr(str)
    }),
    revision_notes: arr(obj({ feedback_quote: str, what_changed: str }))
  })
}

const validate = new Ajv({ allErrors: true, strict: false }).compile(writer_draft.schema)

/** Schema errors for a parsed answer ([] when valid). */
export function draftSchemaErrors(value) {
  if (!value || typeof value !== 'object') return ['/ the answer is not a JSON object']
  return validate(value) ? [] : validate.errors.slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}`)
}
