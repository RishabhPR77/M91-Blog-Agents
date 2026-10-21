// @m91/content — the post format shared by the engine (Publisher) and the blog app.

import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import { BLOCK_TYPES, BUILT_BLOCK_TYPES, BLOCK_ID_RE, isBlockType, isBuiltBlockType } from './blocks.js'

import { GUIDE_SCHEMA, GUIDE_COMPONENT_SCHEMAS, HERO_SCENE_SCHEMA, guideRuleErrors } from './guide.js'

export { BLOCK_TYPES, BUILT_BLOCK_TYPES, BLOCK_ID_RE, isBlockType, isBuiltBlockType }
export * from './guide.js'

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

export const POST_SCHEMA = readJson('./post.schema.json')

/** One data schema per built block type (src/blocks/<type>.schema.json). */
export const BLOCK_SCHEMAS = Object.freeze(Object.fromEntries(BUILT_BLOCK_TYPES.map((t) => [t, readJson(`./blocks/${t}.schema.json`)])))

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(POST_SCHEMA)
const blockValidators = Object.fromEntries(Object.entries(BLOCK_SCHEMAS).map(([t, s]) => [t, ajv.compile(s)]))

/**
 * Checks one block: a known type, an id like b1, and (for built types) data that matches its schema.
 * Reserved types (not built yet) only need a data object. Returns error strings (empty when valid).
 */
export function validateBlock(block, path = '/block') {
  const errors = []
  if (!block || typeof block !== 'object' || Array.isArray(block)) return [`${path} must be an object`]
  if (!isBlockType(block.type)) errors.push(`${path}/type "${block.type}" is not a known block type`)
  if (typeof block.id !== 'string' || !BLOCK_ID_RE.test(block.id)) errors.push(`${path}/id "${block.id}" must look like b1, b2, …`)
  if (!block.data || typeof block.data !== 'object' || Array.isArray(block.data)) {
    errors.push(`${path}/data must be an object`)
  } else if (isBuiltBlockType(block.type)) {
    const check = blockValidators[block.type]
    if (!check(block.data)) for (const e of check.errors) errors.push(`${path}/data${e.instancePath || ''} ${e.message} (${block.type})`)
  }
  return errors
}

const guideValidator = ajv.compile(GUIDE_SCHEMA)
const heroValidator = ajv.compile(HERO_SCENE_SCHEMA)
const componentValidators = Object.fromEntries(Object.entries(GUIDE_COMPONENT_SCHEMAS).map(([t, s]) => [t, ajv.compile(s)]))
const ajvErrors = (check, path) => check.errors.map((e) => `${path}${e.instancePath || ''} ${e.message}`)

/**
 * Checks a guide document (Phase 10): its shape, the hero, every component's data against its type's schema,
 * then the rules a schema cannot express (see guideRuleErrors). Every error starts with /guide.
 * @param {object} guide
 * @param {{ title?: string }} [post] the post's title, for the title_accent check
 */
export function validateGuide(guide, post = {}) {
  if (!guide || typeof guide !== 'object' || Array.isArray(guide)) return ['/guide must be an object']
  if (!guideValidator(guide)) return ajvErrors(guideValidator, '/guide')
  const errors = []
  if (!heroValidator(guide.hero)) errors.push(...ajvErrors(heroValidator, '/guide/hero'))
  guide.chapters.forEach((c, i) => c.components.forEach((x, k) => {
    const check = componentValidators[x.type]
    if (!check(x.data)) errors.push(...ajvErrors(check, `/guide/chapters/${i}/components/${k}/data`).map((e) => `${e} (${x.type})`))
  }))
  if (errors.length) return errors
  return guideRuleErrors(guide, { title: post.title })
}

/** Validates a post against format v1, including its blocks (types, ids, data schemas). Returns { valid, errors[] }. */
export function validatePost(post) {
  const errors = []
  if (!validate(post)) {
    for (const e of validate.errors) errors.push(`${e.instancePath || '/'} ${e.message}`)
  }
  if (Array.isArray(post?.blocks)) {
    const seen = new Set()
    post.blocks.forEach((b, i) => {
      errors.push(...validateBlock(b, `/blocks/${i}`))
      if (b && typeof b.id === 'string') {
        if (seen.has(b.id)) errors.push(`/blocks/${i}/id "${b.id}" is used twice`)
        seen.add(b.id)
      }
    })
  }
  if (post?.guide && typeof post.guide === 'object') errors.push(...validateGuide(post.guide, post))
  return { valid: errors.length === 0, errors }
}
