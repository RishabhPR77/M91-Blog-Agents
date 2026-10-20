// The Designer (Phase 8): chooses which parts of an approved post become interactive blocks. It never writes
// text: it sees numbered parts (previews only) and answers with a plan; code builds the blocks from the exact
// Markdown and checks their integrity. It can never block publishing: a failed call, an invalid plan or a failed
// integrity check saves a "fallback" block_doc (blocks: null) and the post publishes as plain Markdown.

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso, istDate } from '../util/time.js'
import { randomCode } from '../util/ids.js'
import { createViaSocketClient } from '../viasocket.js'
import { throwIfCancelled, CancelledError, isCancel } from '../events.js'
import { loadBrief } from '../writer/inputs.js'
import { draftVersion, draftBriefVersion, draftsOf } from '../writer/save.js'
import { parseParts, bodyMarkdown } from './parts.js'
import { buildBlocks } from './build.js'
import { checkIntegrity } from './integrity.js'
import { designer_plan, planSchemaErrors } from './schemas.js'
import { buildDesignerPrompt, buildDesignerMessage, designerRepairTail } from './prompts.js'
import { saveRunLog } from '../util/runlog.js'

export class DesignerError extends Error {
  constructor(message, { kind, status = 400 } = {}) {
    super(message)
    this.name = 'DesignerError'
    this.status = status
    if (kind) this.kind = kind
  }
}

export const designerThreadId = (briefId, version) => `designer-${briefId}-v${version}-${randomCode(4).toLowerCase()}`

/** The draft a post is built from: the newest approved or published draft (or the given version). */
export async function designableDraft(store, briefId, { version } = {}) {
  return (await draftsOf(store, briefId)).find((d) => (d.status === 'approved' || d.status === 'published') && (version == null || draftVersion(d) === Number(version))) ?? null
}

/** Is the post interactive? The draft's own flag, else INTERACTIVE_DEFAULT. */
export const isInteractive = (draftRec, config) => (typeof draftRec?.metadata?.interactive === 'boolean' ? draftRec.metadata.interactive : config.designer.interactiveDefault)

/** "4 blocks: steps_checklist, phone_ring_sim · 1 dropped · integrity passed" */
export function designerSummary({ status, kept = [], dropped = [], integrity, error }) {
  if (error) return `fallback (plain text): ${error}`
  const types = kept.map((k) => k.block_type)
  const head = types.length ? `${types.length} block${types.length === 1 ? '' : 's'}: ${types.join(', ')}` : 'no interactive blocks'
  const tail = [dropped.length ? `${dropped.length} dropped` : null, integrity ? `integrity ${integrity.passed ? 'passed' : 'failed'}` : null].filter(Boolean)
  return `${status === 'fallback' ? 'fallback (plain text): ' : ''}${[head, ...tail].join(' · ')}`
}

/**
 * @param {{ briefId, version?, runId?, draft?, brief? }} params  draft/brief: in-memory hand-over (DRY_RUN)
 * @param {{ config?, store, aiSend?, now?, integrity? }} deps  integrity: tests only (replaces checkIntegrity)
 * @returns {{ brief_id, version, status: "ok"|"fallback", blocks, kept, dropped, integrity, record_id, model_used, repairs_used, warnings, calls, summary_line }}
 */
export async function runDesigner(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const dc = config.designer
  if (!params.briefId) throw new DesignerError('runDesigner needs a brief_id')
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const runId = params.runId ?? params.briefId
  const dry = config.runtime.dryRun
  const calls = []
  const warnings = []
  const started = now()

  const draftRec = (dry && params.draft ? { id: null, version: params.draft.version, metadata: { brief_version: params.draft.brief_version }, payload: params.draft } : null) ??
    (await designableDraft(store, params.briefId, { version: params.version }))
  if (!draftRec) throw new DesignerError(`brief ${params.briefId} has no approved or published draft${params.version ? ` v${params.version}` : ''}`, { kind: 'no_draft', status: 404 })
  const version = draftVersion(draftRec)
  const briefVersion = draftBriefVersion(draftRec)
  const briefRec = (await loadBrief(store, params.briefId, briefVersion)) ?? (params.brief ? { payload: params.brief } : null)
  const parsed = parseParts(bodyMarkdown(draftRec.payload?.post_markdown))
  const prompt = buildDesignerPrompt(dc.maxInteractiveBlocks)
  const message = buildDesignerMessage({ parts: parsed.parts, draft: draftRec.payload, brief: briefRec?.payload, maxBlocks: dc.maxInteractiveBlocks })
  const threadId = designerThreadId(params.briefId, version)

  async function runLog(entry) {
    const record = { run_id: runId, brief_id: params.briefId, agent: 'designer', time: istIso(new Date(now())), ...entry }
    calls.push(record)
    log.info('designer call', record)
    try {
      await saveRunLog(store, { briefId: runId, payload: record, status: entry.error ? 'error' : entry.result })
    } catch (e) {
      log.error('could not write designer run_log', { error: e })
    }
  }

  async function send(call, tail = '') {
    throwIfCancelled()
    const t0 = now()
    try {
      const r = await aiSend({ agent: 'designer', call, prompt, message: tail ? `${message}\n${tail}` : message, jsonSchema: designer_plan, threadId, retries: config.viasocket.maxRetries })
      const errors = planSchemaErrors(r.content)
      await runLog({ call, model: r.model ?? dc.model, delivery: r.delivery ?? dc.delivery, ms: r.ms ?? now() - t0, result: errors.length ? 'schema_invalid' : 'ok', schema_errors: errors, error: null })
      return { plan: errors.length ? null : r.content, raw: r.content, errors, model: r.model ?? dc.model }
    } catch (error) {
      if (error instanceof CancelledError || isCancel(error)) throw error
      await runLog({ call, model: dc.model, delivery: dc.delivery, ms: now() - t0, result: 'error', schema_errors: [], error: error.message })
      return { plan: null, raw: null, errors: [], model: dc.model, failed: error.message }
    }
  }

  // The call, and up to DESIGNER_MAX_REPAIRS repairs when the plan does not match the schema.
  let res = await send('designer')
  let repairs = 0
  while (!res.plan && !res.failed && repairs < dc.maxRepairs) {
    repairs++
    res = await send('designer_repair', designerRepairTail(res.raw, res.errors))
  }

  let status = 'fallback'
  let blocks = null
  let built = { blocks: [], layout: [], kept: [], dropped: [] }
  let integrity = null
  let error = null
  if (res.failed) error = `the Designer call failed: ${res.failed}`
  else if (!res.plan) error = `the plan did not match the schema after ${repairs} repair(s): ${res.errors.slice(0, 3).join('; ')}`
  else {
    built = buildBlocks(res.plan, parsed, { maxBlocks: dc.maxInteractiveBlocks })
    integrity = (deps.integrity ?? checkIntegrity)({ markdown: parsed.markdown, parts: parsed.parts, blocks: built.blocks, layout: built.layout })
    if (!integrity.passed) error = `the integrity check failed: ${integrity.details.slice(0, 3).join('; ')}`
    else {
      status = 'ok'
      // No interactive block kept: the post stays plain Markdown (blocks: null) — same page, simpler path.
      blocks = built.kept.length ? built.blocks : null
    }
  }
  for (const d of built.dropped) warnings.push(`Designer segment dropped (${d.block_type} ${d.part_ids.join(',')}): ${d.reason}`)
  if (error) warnings.push(`Designer fallback, the post stays plain Markdown: ${error}`)

  throwIfCancelled()
  const summary_line = designerSummary({ status, kept: built.kept, dropped: built.dropped, integrity, error: res.plan ? null : error })
  const payload = {
    brief_id: params.briefId, brief_version: briefVersion, version,
    plan: res.plan ?? null,
    blocks,
    layout: blocks ? built.layout : null,
    kept_segments: built.kept,
    dropped_segments: built.dropped,
    integrity: integrity ?? { passed: false, details: error ? [error] : [] },
    parts: parsed.parts.map((p) => ({ id: p.id, type: p.type, preview: p.preview })),
    error,
    summary: summary_line,
    model_used: res.model,
    repairs_used: repairs,
    ms: now() - started,
    created_at: istIso(new Date(now()))
  }
  const record = await store.createRecord({ type: 'block_doc', briefId: params.briefId, payload, status, version, date: istDate(), meta: { brief_version: briefVersion } })
  if (dry) log.info('DRY_RUN: block_doc not saved', { status, blocks: blocks?.length ?? 0, dropped: built.dropped.length })
  return {
    brief_id: params.briefId, version, brief_version: briefVersion, status, blocks, layout: payload.layout, kept: built.kept, dropped: built.dropped,
    integrity: payload.integrity, record_id: record.id, model_used: res.model, repairs_used: repairs, warnings, calls, summary_line, error
  }
}

/** The newest block_doc of a brief's draft version, or null. */
export async function latestBlockDoc(store, briefId, version) {
  const docs = await store.getRecords({ type: 'block_doc', brief_id: briefId })
  return docs
    .filter((d) => Number(d.payload?.version ?? d.version) === Number(version))
    .sort((a, b) => String(b.payload?.created_at ?? b.createdAt ?? b.date).localeCompare(String(a.payload?.created_at ?? a.createdAt ?? a.date)))[0] ?? null
}
