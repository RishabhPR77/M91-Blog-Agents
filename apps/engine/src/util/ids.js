import { randomInt } from 'node:crypto'
import { istParts } from './time.js'

// No 0/O, 1/I: easy to read aloud and type.
export const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const BRIEF_ID_RE = /^\d{6}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/
// viaSocket thread ids: letters, digits, - and _, up to 100 characters.
export const THREAD_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

export function randomCode(length, rand = randomInt) {
  let out = ''
  for (let i = 0; i < length; i++) out += ID_ALPHABET[rand(ID_ALPHABET.length)]
  return out
}

const pad = (n) => String(n).padStart(2, '0')

/** brief_id: YYMMDD-HHMM-XXXX in IST. */
export function newBriefId(date = new Date(), rand = randomInt) {
  const p = istParts(date)
  return `${pad(p.year % 100)}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}-${randomCode(4, rand)}`
}

/** Record ids with a brief-id-style stamp: C- (cluster), S- (story), T- (tutorial), P- (style profile). */
export function newRecordId(prefix, date = new Date(), rand = randomInt) {
  return `${prefix}-${newBriefId(date, rand)}`
}

/** Scout threads: scout-<run_id>-<call name>-<4 random>. */
export function newScoutThreadId(runId, call, rand = randomInt) {
  const id = `scout-${runId}-${call}-${randomCode(4, rand).toLowerCase()}`
  if (!THREAD_ID_RE.test(id)) throw new Error(`thread id is not valid for viaSocket: ${id}`)
  return id
}

/** Strategist threads: strategist-<run_id>-<plan|repair|rebrief>-<4 random>. */
export function newStrategistThreadId(runId, call, rand = randomInt) {
  const id = `strategist-${runId}-${call}-${randomCode(4, rand).toLowerCase()}`
  if (!THREAD_ID_RE.test(id)) throw new Error(`thread id is not valid for viaSocket: ${id}`)
  return id
}

/** URL slug from a title: lowercase letters, digits and hyphens, at most 60 chars, cut at the last hyphen. */
export function slugify(title, max = 60) {
  const slug = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= max) return slug
  const cut = slug.slice(0, max)
  const lastHyphen = cut.lastIndexOf('-')
  return (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, '')
}

/** A fresh thread per AI call: <agent>-<brief_id>-v<version>-<short random>. */
export function newThreadId(agent, briefId, version = 1, rand = randomInt) {
  const id = `${agent}-${briefId}-v${version}-${randomCode(6, rand).toLowerCase()}`
  if (!THREAD_ID_RE.test(id)) throw new Error(`thread id is not valid for viaSocket: ${id}`)
  return id
}
