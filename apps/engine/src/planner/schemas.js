// The Roadmap Planner's strict answer (Phase 12, Task 2): slots for the six stages. Names, goals and levels of
// the stages come from code (roadmap/model.js); statuses and brief ids are set by code too.

import Ajv from 'ajv'

const str = { type: 'string' }
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = (items) => ({ type: 'array', items })

export const planner_roadmap = {
  name: 'planner_roadmap',
  strict: true,
  schema: obj({
    stages: arr(obj({
      number: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      slots: arr(obj({ slot_id: str, title_idea: str, question: str, teaches: arr(str), needs: arr(str) }))
    })),
    // Slots a guide already live on msg91.com/guide answers (PUBLISHED GUIDES): they are marked covered, never written.
    covered: arr(obj({ slot_id: str, guide_url: str })),
    notes: str
  })
}

const validate = new Ajv({ allErrors: true, strict: false }).compile(planner_roadmap.schema)

/** Schema errors of a parsed answer ([] when valid). */
export function plannerSchemaErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['/ the answer is not a JSON object']
  if (validate(value)) return []
  return [...new Set(validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`))].slice(0, 10)
}
