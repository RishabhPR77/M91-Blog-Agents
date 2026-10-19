// The promo pack's strict JSON schema (Phase 5 brief, D1).

import Ajv from 'ajv'

const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const str = { type: 'string' }
const arr = (items) => ({ type: 'array', items })

export const promo_pack = {
  name: 'promo_pack',
  strict: true,
  schema: obj({
    linkedin_post: str,
    x_thread: arr(str),
    newsletter_blurb: str,
    video_script: arr(obj({ on_screen_text: str, voiceover: str })),
    community_question: str
  })
}

const validate = new Ajv({ allErrors: true, strict: false }).compile(promo_pack.schema)

/** Schema errors for a parsed answer ([] when valid). */
export function promoSchemaErrors(value) {
  if (!value || typeof value !== 'object') return ['/ the answer is not a JSON object']
  return validate(value) ? [] : validate.errors.slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}`)
}
