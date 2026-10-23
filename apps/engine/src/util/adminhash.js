// The admin password hash (Phase 12, hosted login): scrypt from node:crypto, so there is no extra dependency and the
// plain password is never stored. The stored text is  scrypt:<N>:<r>:<p>:<salt>:<hash>  (base64url, no "$" or "=",
// so it is safe in any environment-variable form).
//
// The cost (N=32768, r=8, p=3: about 32 MB and ~0.2 s per check) follows OWASP's scrypt guidance and stays well under
// the hosted app's 256 MB; the server checks one password at a time (see `verifyQueue`) to keep memory bounded.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto'

export const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 3, keylen: 32, saltBytes: 16 })
export const MIN_PASSWORD_LENGTH = 12
const HASH_RE = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9_-]{16,}):([A-Za-z0-9_-]{32,})$/

const run = (password, salt, { N, r, p, keylen }) => new Promise((resolve, reject) => {
  scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)))
})

/** Turns a password into the stored hash text. */
export async function hashPassword(password, { salt = randomBytes(SCRYPT.saltBytes), params = SCRYPT } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw new Error(`the password must have at least ${MIN_PASSWORD_LENGTH} characters`)
  const key = await run(password, salt, params)
  return `scrypt:${params.N}:${params.r}:${params.p}:${salt.toString('base64url')}:${key.toString('base64url')}`
}

/** Splits a stored hash; null when it is not in the expected shape or its cost is out of range. */
export function parseHash(text) {
  const m = HASH_RE.exec(String(text ?? '').trim())
  if (!m) return null
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!(N >= 2 ** 14 && N <= 2 ** 17 && (N & (N - 1)) === 0 && r >= 8 && r <= 16 && p >= 1 && p <= 8)) return null
  return { N, r, p, salt: Buffer.from(m[4], 'base64url'), key: Buffer.from(m[5], 'base64url') }
}

export const isValidHash = (text) => parseHash(text) !== null

/** True when the password matches the stored hash (constant-time compare). Never throws on a bad hash: false. */
export async function verifyPassword(password, stored) {
  const h = parseHash(stored)
  if (!h || typeof password !== 'string') return false
  try {
    const key = await run(password, h.salt, { N: h.N, r: h.r, p: h.p, keylen: h.key.length })
    return timingSafeEqual(key, h.key)
  } catch {
    return false
  }
}

/** Equal text, in constant time (both sides hashed first, so the length is not leaked either). */
export const sameText = (a, b) => timingSafeEqual(createHash('sha256').update(String(a ?? '')).digest(), createHash('sha256').update(String(b ?? '')).digest())
