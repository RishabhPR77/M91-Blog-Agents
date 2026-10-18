// viaSocket AI client: embed token + /embed/ai/message (sync, or rtlayer read back from history).
// Contract: https://flow.viasocket.com/documentation/ai.md

import { signEmbedToken } from 'viasocket-apps'
import { getConfig } from './config.js'
import { log } from './util/log.js'
import { retry, sleep } from './util/retry.js'
import { newThreadId } from './util/ids.js'

/** kind: config | token | billing | rate_limit | server | network | bad_request | timeout | truncated | parse */
export class AiError extends Error {
  constructor(message, { kind, status = null, retryable = false, details } = {}) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
    this.status = status
    this.retryable = retryable
    if (details !== undefined) this.details = details
  }
}

/** The model ran out of output tokens. Later phases catch this and ask for a shorter answer. */
export class TruncatedError extends AiError {
  constructor(result) {
    super('AI answer was truncated (finish_reason "truncated")', { kind: 'truncated' })
    this.name = 'TruncatedError'
    this.result = result
  }
}

/** Maps an HTTP status + body to a typed AiError. */
export function classifyHttpError(status, body) {
  const message = (body && typeof body === 'object' && (body.message || body.error?.message || body.error)) || `HTTP ${status}`
  const text = String(message)
  if (status === 400 && /model or service does not exist/i.test(text)) {
    return new AiError(`viaSocket: model or service does not exist — check *_AI_SERVICE / *_AI_MODEL (${text})`, { kind: 'config', status })
  }
  if (status === 422) return new AiError(`viaSocket validation error — check *_AI_SERVICE spelling (${text})`, { kind: 'config', status })
  if (status === 401 || status === 498) return new AiError(`viaSocket rejected the embed token (${text})`, { kind: 'token', status })
  // Seen live: 402 "Plan credits are exhausted. Upgrade the plan to continue." Retrying cannot help.
  if (status === 402) return new AiError(`viaSocket plan has no credits left (${text})`, { kind: 'billing', status })
  if (status === 429) return new AiError(`viaSocket rate limit (${text})`, { kind: 'rate_limit', status, retryable: true })
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new AiError(`viaSocket server error ${status} (${text})`, { kind: 'server', status, retryable: true })
  }
  return new AiError(`viaSocket request failed ${status} (${text})`, { kind: 'bad_request', status })
}

function normaliseSchema(agent, jsonSchema) {
  if (!jsonSchema) return undefined
  if (jsonSchema.schema) return { name: jsonSchema.name || agent, strict: jsonSchema.strict ?? true, schema: jsonSchema.schema }
  return { name: agent, strict: true, schema: jsonSchema }
}

function parseJsonContent(content) {
  if (content && typeof content === 'object') return content
  try {
    return JSON.parse(content)
  } catch {
    throw new AiError('AI answer was not valid JSON', { kind: 'parse' })
  }
}

/**
 * Creates a client. Everything is injectable so unit tests run with no network.
 * @param {{ config?: object, fetch?: Function, sleepFn?: Function, now?: () => number, signer?: Function }} deps
 */
export function createViaSocketClient({ config = getConfig(), fetch = globalThis.fetch, sleepFn = sleep, now = Date.now, signer = signEmbedToken } = {}) {
  const vs = config.viasocket
  let tokenPromise

  /** The embed token for the one system user. Bare token: no "Bearer". */
  function token() {
    tokenPromise ??= signer({ orgId: vs.orgId, projectId: vs.projectId, uniqueIdentifier: vs.systemUserId, secret: vs.embedSecret })
    return tokenPromise
  }

  async function call(method, path, body) {
    let response
    try {
      response = await fetch(`${vs.apiBase}${path}`, {
        method,
        headers: { authorization: await token(), 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch (error) {
      throw new AiError(`viaSocket unreachable: ${error?.message || 'network error'}`, { kind: 'network', retryable: true })
    }
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }
    if (!response.ok || (payload && payload.success === false)) throw classifyHttpError(response.status, payload)
    return { status: response.status, payload }
  }

  const withRetry = (fn, label, { retries = vs.maxRetries ?? 3, onRetry, shouldRetry } = {}) =>
    retry(fn, {
      retries,
      sleepFn,
      ...(shouldRetry && { shouldRetry }),
      onRetry: (error, attempt, delay) => {
        log.warn('viasocket retry', { label, attempt, delay, error })
        onRetry?.(error, attempt)
      }
    })

  /** S1: GET /embed/authentications — 200 means the token and ids are right. */
  async function checkAuth() {
    const started = now()
    const { status, payload } = await call('GET', '/embed/authentications')
    return { status, count: Array.isArray(payload?.data) ? payload.data.length : null, ms: now() - started }
  }

  /** Polls the thread's history until the assistant message with `messageId` appears. */
  async function waitForAnswer(threadId, messageId, { timeoutMs, pollMs }) {
    const deadline = now() + timeoutMs
    while (now() < deadline) {
      await sleepFn(pollMs)
      let payload
      try {
        ;({ payload } = await call('GET', `/embed/ai/threads/${encodeURIComponent(threadId)}/history?page=1`))
      } catch (error) {
        if (error.retryable) {
          log.warn('viasocket history poll failed; will poll again', { threadId, error })
          continue
        }
        throw error
      }
      const messages = payload?.data?.messages ?? []
      // No messageId (a sync call that hit the gateway timeout): the thread is fresh per call, so its one answer is ours.
      const answer = messages.find((m) => m.role === 'assistant' && (!messageId || m.message_id === messageId))
      if (answer) return answer
    }
    throw new AiError(`No answer in thread history after ${Math.round(timeoutMs / 1000)} s`, { kind: 'timeout' })
  }

  /**
   * Sends one message for an agent, using that agent's service/model/delivery from config.
   * Optional per call: `delivery` overrides the agent's delivery; `retries` caps HTTP retries
   * (default AI_MAX_RETRIES) and `onRetry(error, attempt)` is told about each one.
   * @returns {Promise<{ content, threadId, messageId, finishReason, model, ms, delivery }>}
   */
  async function aiSend({ agent, prompt, message, jsonSchema, threadId, briefId = 'adhoc', version = 1, timeoutMs, pollMs, delivery, retries, onRetry } = {}) {
    const agentSettings = config[agent]
    if (!agentSettings?.service) throw new AiError(`Unknown agent "${agent}"`, { kind: 'config' })
    if (delivery !== undefined && delivery !== 'sync' && delivery !== 'rtlayer') throw new AiError(`aiSend: delivery must be sync or rtlayer`, { kind: 'config' })
    const settings = { ...agentSettings, delivery: delivery ?? agentSettings.delivery }
    if (!message) throw new AiError('aiSend: message is required', { kind: 'bad_request' })
    const thread = threadId ?? newThreadId(agent, briefId, version)
    const schema = normaliseSchema(agent, jsonSchema)
    const body = {
      message,
      thread_id: thread,
      ...(prompt !== undefined && { prompt }),
      service: settings.service,
      model: settings.model,
      ...(schema && { response_type: 'json_schema', json_schema: schema }),
      delivery: settings.delivery
    }

    const started = now()
    log.debug('ai send', { agent, service: settings.service, model: settings.model, delivery: settings.delivery, threadId: thread })
    // A sync call that outlives the gateway gets a 502 after ~1 minute, but the run continues and its
    // answer lands in the thread history (ai.md). Re-sending would pay for the call twice, so read it there.
    const sync = settings.delivery === 'sync'
    const gatewayTimeout = (e) => sync && e?.status === 502
    let payload
    let fromHistory = null
    try {
      ;({ payload } = await withRetry(() => call('POST', '/embed/ai/message', body), `${agent} send`, {
        retries,
        onRetry,
        shouldRetry: (e) => e?.retryable === true && !gatewayTimeout(e)
      }))
    } catch (error) {
      if (!gatewayTimeout(error)) throw error
      log.warn('sync call hit the gateway timeout; reading the answer from thread history instead of re-sending', { agent, threadId: thread })
      fromHistory = await waitForAnswer(thread, null, {
        timeoutMs: timeoutMs ?? vs.rtlayerTimeoutMs ?? 300000,
        pollMs: pollMs ?? vs.pollIntervalMs ?? 3000
      })
    }
    const data = payload?.data ?? {}

    let result
    if (fromHistory) {
      result = {
        content: schema ? parseJsonContent(fromHistory.content) : fromHistory.content,
        threadId: thread,
        messageId: fromHistory.message_id,
        finishReason: fromHistory.finish_reason ?? null,
        model: fromHistory.model ?? null
      }
    } else if (sync) {
      result = {
        content: schema ? parseJsonContent(data.content) : data.content,
        threadId: data.thread_id ?? thread,
        messageId: data.message_id,
        finishReason: data.finish_reason,
        model: data.model ?? null
      }
    } else {
      const messageId = data.message_id
      if (!messageId) throw new AiError('rtlayer send returned no message_id', { kind: 'bad_request' })
      const answer = await waitForAnswer(data.thread_id ?? thread, messageId, {
        timeoutMs: timeoutMs ?? vs.rtlayerTimeoutMs ?? 300000,
        pollMs: pollMs ?? vs.pollIntervalMs ?? 3000
      })
      result = {
        content: schema ? parseJsonContent(answer.content) : answer.content,
        threadId: data.thread_id ?? thread,
        messageId,
        finishReason: answer.finish_reason ?? null,
        model: answer.model ?? null
      }
    }
    result.ms = now() - started
    result.delivery = settings.delivery
    result.recoveredFromHistory = Boolean(fromHistory)
    log.info('ai answer', { agent, model: result.model ?? settings.model, finishReason: result.finishReason, ms: result.ms, threadId: result.threadId })
    if (result.finishReason === 'truncated') throw new TruncatedError(result)
    return result
  }

  return { token, call, checkAuth, aiSend }
}

let defaultClient
/** aiSend with the process config. */
export function aiSend(params) {
  defaultClient ??= createViaSocketClient()
  return defaultClient.aiSend(params)
}
