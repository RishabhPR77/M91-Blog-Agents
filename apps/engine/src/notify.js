// Slack + M91 alerts through two viaSocket webhook flows (docs/SETUP_FLOWS.md).

import { getConfig } from './config.js'
import { log } from './util/log.js'

export const SLACK_PART_MAX = 2800
export const SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

function hardSplit(text, max) {
  const out = []
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max))
  return out
}

// Packs pieces joined by `sep` into chunks of at most `max`; oversize pieces go to `split`.
function pack(pieces, sep, max, split) {
  const chunks = []
  let current = ''
  for (const piece of pieces) {
    if (piece.length > max) {
      if (current) chunks.push(current)
      current = ''
      chunks.push(...split(piece))
      continue
    }
    const candidate = current ? current + sep + piece : piece
    if (candidate.length <= max) current = candidate
    else {
      chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** Splits text into parts of ≤ max chars, by paragraph, then line, then hard cut; numbers them "(1/3) ". */
export function chunkText(text, max = SLACK_PART_MAX) {
  const body = String(text ?? '').trim()
  if (body.length <= max) return [body]
  const room = max - '(99/99) '.length
  const byLine = (para) => pack(para.split('\n'), '\n', room, (line) => hardSplit(line, room))
  const parts = pack(body.split(/\n{2,}/), '\n\n', room, byLine)
  return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`)
}

export class NotifyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NotifyError'
  }
}

export function createNotifier({ config = getConfig(), fetch = globalThis.fetch } = {}) {
  const { slackWebhookUrl, m91WebhookUrl, sharedKey } = config.notify
  const dryRun = config.runtime.dryRun

  async function post(url, body, label) {
    if (!url) throw new NotifyError(`${label} webhook URL is not set (${label === 'Slack' ? 'SLACK_POST_WEBHOOK_URL' : 'M91_ALERT_WEBHOOK_URL'})`)
    if (!sharedKey) throw new NotifyError('WEBHOOK_SHARED_KEY is not set')
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }
    // A viaSocket webhook run answers 200 even when a step failed; the body says so.
    if (!res.ok) throw new NotifyError(`${label} webhook answered HTTP ${res.status}`)
    if (payload && typeof payload === 'object' && (payload.error || payload.ok === false)) {
      throw new NotifyError(`${label} flow reported a failed step`)
    }
    return payload
  }

  // Phase 5 A4: until the two viaSocket flows exist, a send with an empty webhook URL is skipped
  // and reported as "pending flows" instead of failing the run.
  const pendingFlows = (key, what) => {
    log.warn(`pending flows: ${key} is empty, ${what} skipped`)
    return { skipped: 'pending_flows', key }
  }

  async function slack(text) {
    const parts = chunkText(text, config.notify.chunkChars ?? SLACK_PART_MAX)
    if (dryRun) {
      log.info('DRY_RUN: would post to Slack', { parts: parts.length, preview: parts.map((p) => p.slice(0, 200)) })
      return { dryRun: true, parts: parts.length }
    }
    if (!slackWebhookUrl) return { ...pendingFlows('SLACK_POST_WEBHOOK_URL', `Slack message (${parts.length} part(s))`), parts: parts.length }
    for (const part of parts) await post(slackWebhookUrl, { key: sharedKey, text: part }, 'Slack')
    log.info('slack sent', { parts: parts.length })
    return { dryRun: false, parts: parts.length }
  }

  async function m91Alert({ title, description, severity = 'LOW' } = {}) {
    const level = String(severity).toUpperCase()
    if (!title) throw new NotifyError('m91Alert: title is required')
    if (!SEVERITIES.includes(level)) throw new NotifyError(`m91Alert: severity must be one of ${SEVERITIES.join(', ')}`)
    const body = { key: sharedKey, title, description: description ?? '', severity: level }
    if (dryRun) {
      log.info('DRY_RUN: would send M91 alert', { title, severity: level, description: body.description.slice(0, 300) })
      return { dryRun: true }
    }
    if (!m91WebhookUrl) return pendingFlows('M91_ALERT_WEBHOOK_URL', `M91 alert "${title}"`)
    await post(m91WebhookUrl, body, 'M91')
    log.info('m91 alert sent', { title, severity: level })
    return { dryRun: false }
  }

  return { slack, m91Alert }
}

let defaultNotifier
export const notify = {
  slack: (text) => (defaultNotifier ??= createNotifier()).slack(text),
  m91Alert: (args) => (defaultNotifier ??= createNotifier()).m91Alert(args)
}
