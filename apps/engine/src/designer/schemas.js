// The Designer's strict answer schema (Phase 8, section 7.3).

import Ajv from 'ajv'
import { DESIGNER_BLOCK_TYPES, ACTORS } from './build.js'

export const designer_plan = {
  name: 'designer_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['segments', 'notes'],
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['block_type', 'part_ids', 'callout_tone', 'moment_actors', 'why'],
          properties: {
            block_type: { type: 'string', enum: [...DESIGNER_BLOCK_TYPES] },
            part_ids: { type: 'array', items: { type: 'string' } },
            callout_tone: { type: 'string', enum: ['info', 'tip', 'warning', 'none'] },
            moment_actors: { type: 'array', items: { type: 'string', enum: [...ACTORS] } },
            why: { type: 'string' }
          }
        }
      },
      notes: { type: 'string' }
    }
  }
}

const validate = new Ajv({ allErrors: true, strict: false }).compile(designer_plan.schema)

/** Schema errors for a parsed answer ([] when valid). */
export function planSchemaErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['/ the answer is not a JSON object']
  return validate(value) ? [] : validate.errors.slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}`)
}
