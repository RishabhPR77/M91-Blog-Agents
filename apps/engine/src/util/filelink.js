// Signed links to a post's final Markdown file, for the email attachment: Gmail (through the blog-mail-post flow) fetches
// the file by URL, without the dashboard login. The link names the brief, an expiry time and an HMAC of both; it works
// until it expires (FILE_LINK_DAYS, at most MAX_LINK_DAYS) and for no other brief. Code only, nothing stored.
// The HMAC key comes from PIPELINE_TRIGGER_KEY, which never leaves the engine (WEBHOOK_SHARED_KEY is sent to every
// viaSocket flow, so anyone who can read a flow's input could mint links with it); WEBHOOK_SHARED_KEY is the fallback.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const FILE_LINK_RE = /^\/files\/exports\/([\w-]+)\/(\d{10})\/([a-f0-9]{32})\/([\w.-]+\.md)$/
export const MAX_LINK_DAYS = 30

const keyOf = (secret) => createHmac('sha256', 'm91-file-link').update(String(secret)).digest()
const sign = (secret, briefId, exp) => createHmac('sha256', keyOf(secret)).update(`${briefId}.${exp}`).digest('hex').slice(0, 32)

/** The secret that signs file links: the trigger key, else the webhook key; null without either. */
export function fileLinkSecret(config) {
  return config?.runtime?.triggerKey || config?.notify?.sharedKey || null
}

/** The path of a signed link ("/files/exports/<brief>/<exp>/<sig>/<file.md>"), or null without a secret. */
export function signedFilePath({ briefId, filename, secret, days = 7, now = Date.now }) {
  if (!secret) return null
  const exp = Math.floor(now() / 1000) + Math.min(days, MAX_LINK_DAYS) * 86400
  return `/files/exports/${briefId}/${exp}/${sign(secret, briefId, exp)}/${filename}`
}

/** { ok, briefId, filename } for a valid, unexpired link; { ok: false, why } otherwise. */
export function checkFilePath(path, { secret, now = Date.now }) {
  const m = FILE_LINK_RE.exec(path)
  if (!m || !secret) return { ok: false, why: 'not_a_file_link' }
  const [, briefId, exp, sig, filename] = m
  const nowSec = Math.floor(now() / 1000)
  if (Number(exp) < nowSec) return { ok: false, why: 'expired' }
  // No link is ever made for longer than MAX_LINK_DAYS: a later expiry was not made here.
  if (Number(exp) > nowSec + MAX_LINK_DAYS * 86400 + 60) return { ok: false, why: 'bad_signature' }
  const want = Buffer.from(sign(secret, briefId, exp))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, why: 'bad_signature' }
  return { ok: true, briefId, filename }
}
