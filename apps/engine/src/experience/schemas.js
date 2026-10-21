// The Experience Designer's strict answer (Phase 10, C2): a plan for the guide. The Writer's text and code are
// never in it: components that show the post's text name the parts (part_ids) or a snippet (snippet_id), and
// code copies the exact text in (build.js). Every field is required (strict JSON schema): "" / [] / 0 mean
// "not used".

import Ajv from 'ajv'
import { GUIDE_STATES } from '@m91/content'

const str = { type: 'string' }
const int = { type: 'integer' }
const strs = { type: 'array', items: str }
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = (items) => ({ type: 'array', items })
const type = (name) => ({ type: 'string', enum: [name] })
const state = { type: 'string', enum: [...GUIDE_STATES] }

/** One variant per component type (anyOf). */
export const COMPONENT_VARIANTS = Object.freeze({
  prose: obj({ type: type('prose'), part_ids: strs }),
  journey_steps: obj({ type: type('journey_steps'), current: int, steps: arr(obj({ title: str, text: str })) }),
  phone_ring_sim: obj({ type: type('phone_ring_sim'), part_ids: strs, states: arr(state) }),
  approve_demo: obj({ type: type('approve_demo'), request: str, context: str, approve_label: str, approve_outcome: str, reject_label: str, reject_outcome: str }),
  route_compare: obj({ type: type('route_compare'), caption: str, routes: arr(obj({ name: str, best_for: str, stops: strs, highlight: { type: 'boolean' } })) }),
  steps_checklist: obj({ type: type('steps_checklist'), part_ids: strs, intro: str, titles: strs, stuck: arr(obj({ step: int, cause: str, fix: str })) }),
  tool_picker: obj({ type: type('tool_picker'), question: str, options: arr(obj({ id: str, label: str, steps: strs, snippet_id: str, done: str })) }),
  file_card: obj({ type: type('file_card'), part_ids: strs, snippet_id: str, line_from: int, line_to: int, filename: str, what: str, preview_lines: int }),
  troubleshooting_picker: obj({ type: type('troubleshooting_picker'), part_ids: strs, question: str }),
  comparison_table: obj({ type: type('comparison_table'), part_ids: strs, caption: str }),
  faq: obj({ type: type('faq'), part_ids: strs })
})

export const experience_plan = {
  name: 'experience_plan',
  strict: true,
  schema: obj({
    title_accent: str,
    hero: obj({ agent: str, request: str, person: str, decision: { type: 'string', enum: ['approved', 'rejected'] }, result: str }),
    status_states: arr(obj({ state, chapter: int })),
    chapters: arr(obj({
      label: str,
      heading_part_id: str,
      heading: str,
      intro: str,
      components: arr({ anyOf: Object.values(COMPONENT_VARIANTS) })
    })),
    your_turn_title: str,
    notes: str
  })
}

const validate = new Ajv({ allErrors: true, strict: false }).compile(experience_plan.schema)

/** Schema errors for a parsed answer ([] when valid). anyOf errors are summed up per component. */
export function planSchemaErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['/ the answer is not a JSON object']
  if (validate(value)) return []
  const seen = new Set()
  const out = []
  for (const e of validate.errors) {
    const at = e.instancePath.replace(/\/components\/(\d+)\/.*/, '/components/$1')
    const msg = /\/components\/\d+$/.test(at) ? `${at} does not match any component type's fields` : `${e.instancePath || '/'} ${e.message}`
    if (!seen.has(msg)) out.push(msg)
    seen.add(msg)
  }
  return out.slice(0, 10)
}
