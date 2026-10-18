// @m91/content — the post format shared by the engine (Publisher) and the blog app.

import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import { BLOCK_TYPES, isBlockType } from './blocks.js'

export { BLOCK_TYPES, isBlockType }

export const POST_SCHEMA = JSON.parse(readFileSync(new URL('./post.schema.json', import.meta.url), 'utf8'))

const validate = new Ajv({ allErrors: true, strict: false }).compile(POST_SCHEMA)

/** Validates a post against format v1, including known block types. Returns { valid, errors[] }. */
export function validatePost(post) {
  const errors = []
  if (!validate(post)) {
    for (const e of validate.errors) errors.push(`${e.instancePath || '/'} ${e.message}`)
  }
  if (Array.isArray(post?.blocks)) {
    post.blocks.forEach((b, i) => {
      if (b && typeof b === 'object' && !isBlockType(b.type)) errors.push(`/blocks/${i}/type "${b.type}" is not a known block type`)
    })
  }
  return { valid: errors.length === 0, errors }
}
