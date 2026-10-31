// Signed links to a post's final Markdown file, for the email attachment: Gmail (through the blog-mail-post flow) fetches
// the file by URL, without the dashboard login. The link names the brief, an expiry time and an HMAC of both, keyed from
// WEBHOOK_SHARED_KEY; it works until it expires (FILE_LINK_DAYS) and for no other brief. Code only, nothing stored.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const FILE_LINK_RE = /^\/files\/exports\/([\w-]+)\/(\d{10})\/([a-f0-9]{32})\/([\w.-]+\.md)$/

const keyOf = (secret) => createHmac('sha256', 'm91-file-link').update(String(secret)).digest()
const sign = (secret, briefId, exp) => createHmac('sha256', keyOf(secret)).update(`${briefId}.${exp}`).digest('hex').slice(0, 32)

/** The path of a signed link ("/files/exports/<brief>/<exp>/<sig>/<file.md>"), or null without a secret. */
export function signedFilePath({ briefId, filename, secret, days = 7, now = Date.now }) {
  if (!secret) return null
  const exp = Math.floor(now() / 1000) + days * 86400
  return `/files/exports/${briefId}/${exp}/${sign(secret, briefId, exp)}/${filename}`
}

/** { ok, briefId, filename } for a valid, unexpired link; { ok: false, why } otherwise. */
export function checkFilePath(path, { secret, now = Date.now }) {
  const m = FILE_LINK_RE.exec(path)
  if (!m || !secret) return { ok: false, why: 'not_a_file_link' }
  const [, briefId, exp, sig, filename] = m
  if (Number(exp) * 1000 < now()) return { ok: false, why: 'expired' }
  const want = Buffer.from(sign(secret, briefId, exp))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, why: 'bad_signature' }
  return { ok: true, briefId, filename }
}
