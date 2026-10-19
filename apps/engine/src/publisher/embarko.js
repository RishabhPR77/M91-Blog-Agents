// Embarko deploy for the blog (Phase 7 C6), following https://embarko.ai/docs (deploy, static-sites,
// status, errors): POST <EMBARKO_API_BASE>/apps as multipart with the .tar.gz in the field "source",
// headers X-App-Name, X-Agent-Name and Authorization: Bearer <token>; a static site usually answers
// 200 "live", else poll GET /apps/<name>/status every 2 s (with the token: a claimed app answers 404 without it).
// Retry rules (errors doc): 4xx never; 5xx and lost replies once, after a status check (it may have been accepted).
// The token goes only into the Authorization header: never into a log, an error, an event or a file.

import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sleep as defaultSleep } from '../util/retry.js'

export class EmbarkoError extends Error {
  constructor(code, message, { status = null, next = null, retryable = false } = {}) {
    super(message)
    this.name = 'EmbarkoError'
    this.code = code
    this.status = status
    this.next = next
    this.retryable = retryable
  }
}

// ---------- .tar.gz (ustar) of a folder's contents, so index.html sits at the top ----------

function header(name, size, type) {
  const h = Buffer.alloc(512)
  let prefix = ''
  let n = name
  if (Buffer.byteLength(n) > 100) {
    const cut = n.lastIndexOf('/', 155)
    if (cut <= 0 || Buffer.byteLength(n.slice(cut + 1)) > 100) throw new EmbarkoError('path_too_long', `a file path is too long for the upload: ${name}`)
    prefix = n.slice(0, cut)
    n = n.slice(cut + 1)
  }
  const put = (str, off, len) => h.write(str, off, len, 'utf8')
  const oct = (num, len) => num.toString(8).padStart(len - 1, '0') + '\0'
  put(n, 0, 100)
  put(oct(type === '5' ? 0o755 : 0o644, 8), 100, 8)
  put(oct(0, 8), 108, 8)
  put(oct(0, 8), 116, 8)
  put(oct(size, 12), 124, 12)
  put(oct(0, 12), 136, 12) // a fixed mtime keeps the archive reproducible
  put('        ', 148, 8)
  put(type, 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  put(prefix, 345, 155)
  let sum = 0
  for (const b of h) sum += b
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

/** The folder's contents (not the folder itself) as a gzipped ustar archive. */
export function packDir(dir) {
  const parts = []
  const walk = (abs, rel) => {
    for (const f of readdirSync(abs).sort()) {
      const a = join(abs, f)
      const r = rel ? `${rel}/${f}` : f
      if (statSync(a).isDirectory()) {
        parts.push(header(`${r}/`, 0, '5'))
        walk(a, r)
      } else {
        const data = readFileSync(a)
        parts.push(header(r, data.length, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512))
      }
    }
  }
  walk(dir, '')
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

// ---------- errors ----------

const MESSAGES = {
  unauthorized: 'the deploy token is missing or wrong (EMBARKO_DEPLOY_TOKEN)',
  app_name_taken: "the blog's app name is taken: choose another BLOG_APP_NAME",
  app_name_reserved: 'BLOG_APP_NAME is a reserved Embarko name: choose another',
  invalid_app_name: 'BLOG_APP_NAME breaks the naming rules (a-z, 0-9 and "-", 3–63 characters)',
  app_name_too_short: 'BLOG_APP_NAME must be 3–63 characters',
  app_name_too_long: 'BLOG_APP_NAME must be 3–63 characters',
  app_kind_changed: 'an Embarko app with this name is a server app; a static site cannot replace it: choose another BLOG_APP_NAME',
  no_manifest_at_root: 'the upload has no index.html at the top',
  app_nested_in_subdirectory: 'the upload is nested in a subfolder',
  source_too_large: 'the upload is too large',
  too_many_files: 'the upload has too many files',
  missing_source_file: 'the upload had no files',
  rename_in_progress: 'the blog app is being renamed on Embarko: try again later',
  host_not_allowed: 'this machine cannot reach the Embarko deploy API'
}

async function replyOf(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 200) }
  }
}

function errorFrom(status, body) {
  const code = body?.code ?? (status === 401 ? 'unauthorized' : status === 429 ? 'rate_limited' : `http_${status}`)
  const message = MESSAGES[code] ?? (status === 429 ? 'Embarko is rate limiting deploys: try again in a few minutes' : `Embarko answered HTTP ${status}${body?.error ? `: ${String(body.error).slice(0, 200)}` : ''}`)
  return new EmbarkoError(code, message, { status, next: body?.next ?? null, retryable: status >= 500 })
}

const FINAL_OK = 'live'
const FINAL_BAD = ['failed', 'crashed', 'not_deployed']

/**
 * Deploys the folder as the blog app and waits until it is live.
 * @returns {{ status: 'live', app, kind, claimed, url, polls }}  Throws EmbarkoError.
 * onEvent(info) gets { phase, status, code } for logs and events (never headers or the token).
 */
export async function deploy({ dir, appName, agentName, token, apiBase, fetch = globalThis.fetch, sleepFn = defaultSleep, pollMs = 2000, maxPollMs = 15 * 60 * 1000, onEvent = () => {} }) {
  if (!token) throw new EmbarkoError('no_token', 'EMBARKO_DEPLOY_TOKEN is not set: the Publisher never deploys without a token (a token-less app is deleted after 24 hours)')
  const auth = { Authorization: `Bearer ${token}` }
  const archive = packDir(dir)

  const statusOnce = async () => {
    const res = await fetch(`${apiBase}/apps/${encodeURIComponent(appName)}/status`, { headers: { ...auth, 'X-Agent-Name': agentName } })
    const body = await replyOf(res)
    if (!res.ok) throw errorFrom(res.status, body)
    return body
  }

  const poll = async () => {
    const started = Date.now()
    let polls = 0
    for (;;) {
      const body = await statusOnce()
      polls++
      onEvent({ phase: 'status', status: body.status })
      if (body.status === FINAL_OK) return { body, polls }
      if (FINAL_BAD.includes(body.status)) throw new EmbarkoError(`deploy_${body.status}`, `the deploy ended "${body.status}"${body.error ? `: ${String(body.error).slice(0, 200)}` : ''}`, { next: body.next ?? null })
      if (Date.now() - started > maxPollMs) throw new EmbarkoError('status_timeout', `the deploy was not live after ${Math.round(maxPollMs / 60000)} minutes (last status "${body.status}")`)
      await sleepFn(pollMs)
    }
  }

  const send = async () => {
    const form = new FormData()
    form.append('source', new Blob([archive], { type: 'application/gzip' }), 'site.tar.gz')
    const res = await fetch(`${apiBase}/apps`, { method: 'POST', headers: { ...auth, 'X-App-Name': appName, 'X-Agent-Name': agentName }, body: form })
    const body = await replyOf(res)
    onEvent({ phase: 'deploy', status: body.status ?? res.status, code: body.code ?? null })
    if (!res.ok) throw errorFrom(res.status, body)
    return body
  }

  let body
  try {
    body = await send()
  } catch (error) {
    const lostOrServer = !(error instanceof EmbarkoError) || error.retryable
    if (!lostOrServer) throw error
    // The deploy may have been accepted: check the status before sending again (never twice in a row).
    try {
      const s = await statusOnce()
      if (s.status === FINAL_OK || ['building', 'publishing', 'starting', 'unknown'].includes(s.status)) body = s
    } catch {}
    if (!body) {
      await sleepFn(2000)
      body = await send()
    }
  }

  let polls = 0
  if (body.status !== FINAL_OK) ({ body, polls } = await poll())
  return { status: 'live', app: body.app?.name ?? appName, kind: body.app?.kind ?? null, claimed: body.app?.claimed ?? null, url: body.links?.app ?? null, polls }
}
