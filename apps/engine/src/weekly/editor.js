// The weekly editor: one AI call (EDITOR_AI_MODEL) weighs this week's signals and proposes EDITOR_CANDIDATES posts,
// then picks one. Code checks the answer: every candidate must cite at least EDITOR_MIN_EVIDENCE real signals (a news
// hook counts), a hook must be a real news item, and a near-repeat of a live guide or an earlier post is left out.
// If the editor's choice fails a check, the best-scoring candidate that passes is taken; if the call fails or nothing
// passes, code picks the strongest question (or an M91 integration as a tutorial), so a weekly run always writes.
// The decision is saved as one weekly_pick record (the post page shows the reason and the runners-up).
import Ajv from 'ajv'
import { EDITOR } from './prompts.js'
import { weekly_editor } from './schemas.js'
import { repeats } from './repeats.js'
import { signalCounts } from './signals.js'
import { fill } from '../scout/prompts.js'
import { newRecordId, newThreadId } from '../util/ids.js'
import { istDate, istIso } from '../util/time.js'
import { emit, throwIfCancelled, CancelledError } from '../events.js'

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(weekly_editor.schema)
const RETRY_NOTE = 'Your last answer did not match the schema. Return only valid JSON.'
const total = (s = {}) => (s.demand ?? 0) + (s.timeliness ?? 0) + (s.m91_fit ?? 0) + (s.gap ?? 0) + (s.variety ?? 0)
const json = (v) => JSON.stringify(v)
const listOrNone = (arr) => (arr.length ? arr.map(json).join('\n') : 'none')

/** The editor's message: this week's signals and what readers already have. */
export function editorMessage(s) {
  return [
    '--- QUESTIONS ---', listOrNone(s.questions.map(({ id, question, where, posted_date, demand_evidence }) => ({ id, question, where, posted_date, demand_evidence }))),
    '--- NEWS ---', listOrNone(s.news.map(({ id, title, what_happened, outlet, published_date, why_m91, urgency }) => ({ id, title, what_happened, outlet, published_date, why_m91, urgency }))),
    '--- M91 CHANGES ---', listOrNone(s.changes.map(({ id, name, what_it_enables }) => ({ id, name, what_it_enables }))),
    '--- M91 INTEGRATIONS ---', listOrNone(s.integrations.map(({ id, name, what_it_enables }) => ({ id, name, what_it_enables }))),
    '--- PINNED IDEAS ---', listOrNone(s.pins.map(({ id, topic, target_date }) => ({ id, topic, target_date }))),
    '--- LIVE GUIDES ---', s.live.length ? s.live.map((g) => `- ${g.title}`).join('\n') : 'none',
    '--- RECENT POSTS (newest first) ---', listOrNone(s.recent)
  ].join('\n')
}

/** A signal as evidence on the pick: { id, kind, text, url }. */
function evidenceOf(sig) {
  const kind = { q: 'question', n: 'news', m: 'm91_change', i: 'm91_integration', p: 'pinned_idea' }[sig.id[0]] ?? 'signal'
  const text = sig.question ?? sig.title ?? (sig.name ? `${sig.name}: ${sig.what_it_enables ?? ''}` : sig.topic ?? '')
  return { id: sig.id, kind, text, url: sig.source_url ?? null, ...(sig.where && { where: sig.where }), ...(sig.demand_evidence && { demand: sig.demand_evidence }) }
}

/**
 * Checks each candidate against the signals and what readers have. Returns the candidates with
 * { evidence, hook, total, problems } (problems empty = usable).
 */
export function checkCandidates(candidates, signals, { threshold = 0.6, minEvidence = 2 } = {}) {
  const available = signals.byId.size
  const need = Math.max(1, Math.min(minEvidence, available))
  return candidates.map((c) => {
    const problems = []
    const hookSig = c.hook_id && c.hook_id.startsWith('n') ? signals.byId.get(c.hook_id) : null
    if (c.hook_id && !hookSig) problems.push(`hook "${c.hook_id}" is not a news item of this week`)
    const ids = [...new Set([...(c.evidence_ids ?? []), ...(hookSig ? [hookSig.id] : [])])].filter((id) => signals.byId.has(id))
    if (ids.length < need) problems.push(`cites ${ids.length} real signal${ids.length === 1 ? '' : 's'} (needs ${need})`)
    const close = repeats(c.title, `${c.title} ${c.question}`, signals.posts, threshold)
    if (close) problems.push(`repeats ${close.where} "${close.title}"`)
    return { ...c, evidence: ids.map((id) => evidenceOf(signals.byId.get(id))), hook: hookSig ?? null, total: total(c.scores), problems }
  })
}

/** Code's own pick when the editor gives nothing usable: the strongest question, else an integration as a tutorial. */
export function fallbackPick(signals, { threshold = 0.6 } = {}) {
  for (const q of signals.questions) {
    if (repeats(q.question, q.question, signals.posts, threshold)) continue
    return { title: q.question.replace(/\?$/, ''), question: q.question, format: 'explainer', angle: 'answers a question people asked this week', hook_id: '', evidence_ids: [q.id], why_now: `asked recently on ${q.where ?? 'the web'}`, scores: null, evidence: [evidenceOf(q)], hook: null, total: 0, problems: [] }
  }
  for (const i of [...signals.changes, ...signals.integrations]) {
    const title = `How to connect M91 to ${i.name}`
    if (repeats(title, `${title} ${i.what_it_enables ?? ''}`, signals.posts, threshold)) continue
    return { title, question: `How do I connect M91 to ${i.name}?`, format: 'tutorial', angle: i.what_it_enables ?? '', hook_id: '', evidence_ids: [i.id], why_now: i.id.startsWith('m') ? 'new in M91' : 'a documented integration no post covers yet', scores: null, evidence: [evidenceOf(i)], hook: null, total: 0, problems: [] }
  }
  return null
}

/**
 * Runs the editor. deps: { store, config, aiSend, runId, now }. Returns
 * { pick, runners_up, reason, chosen_by, record_id, model, warnings } or { pick: null, reason } when nothing can be written.
 */
export async function runWeeklyEditor(signals, { store, config, aiSend, runId, now = Date.now }) {
  const ec = config.editor
  const warnings = []
  const opts = { threshold: ec.similarity ?? 0.6, minEvidence: ec.minEvidence ?? 2 }
  const today = istDate(new Date(now()))
  let answer = null
  let model = ec.model
  try {
    let prompt = fill(EDITOR, { today, candidates: ec.candidates ?? 4, min_evidence: opts.minEvidence })
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      throwIfCancelled()
      const r = await aiSend({ agent: 'editor', prompt, message: editorMessage(signals), jsonSchema: weekly_editor, threadId: newThreadId('editor', runId), delivery: ec.delivery, retries: config.viasocket?.maxRetries ?? 2 })
      model = r.model ?? model
      if (validate(r.content)) answer = r.content
      else prompt = `${prompt}\n\n${RETRY_NOTE}`
    }
    if (!answer) warnings.push('the editor\'s answer did not match the schema twice: code picked the topic')
  } catch (error) {
    if (error instanceof CancelledError) throw error
    warnings.push(`the editor call failed (${error.message}): code picked the topic`)
  }

  const checked = answer ? checkCandidates(answer.candidates, signals, opts) : []
  const first = checked[answer?.choice ?? -1]
  let pick = null
  let chosenBy = 'editor'
  let reason = answer?.reason ?? ''
  if (first && !first.problems.length) pick = first
  else {
    const usable = checked.filter((c) => !c.problems.length).sort((a, b) => b.total - a.total)
    if (usable.length) {
      pick = usable[0]
      chosenBy = 'editor_runner_up'
      reason = `${pick.why_now} (the editor's first choice${first ? ` "${first.title}" ${first.problems.join('; ')}` : ' was not usable'})`
    } else {
      pick = fallbackPick(signals, opts)
      chosenBy = 'fallback'
      reason = pick ? `${pick.why_now} (code's pick: no candidate of the editor passed the checks)` : 'nothing this week is new for readers: every signal repeats a live guide or an earlier post'
    }
  }
  if (!pick) {
    emit('step.output', { agent: 'editor', step: 'editor', message: reason, data: { counts: signalCounts(signals) } })
    return { pick: null, reason, warnings }
  }

  const runnersUp = checked.filter((c) => c !== pick).map((c) => ({ title: c.title, question: c.question, format: c.format, why_now: c.why_now, total: c.total, hook: c.hook ? { title: c.hook.title, source_url: c.hook.source_url } : null, ...(c.problems.length && { left_out: c.problems.join('; ') }) }))
  const payload = {
    pick_id: newRecordId('W', new Date(now())), run_id: runId, date: today, chosen_at: istIso(new Date(now())), chosen_by: chosenBy, model, reason,
    pick: { title: pick.title, question: pick.question, format: pick.format, angle: pick.angle, why_now: pick.why_now, scores: pick.scores, total: pick.total, evidence: pick.evidence, hook: pick.hook ? { record_id: pick.hook.record_id, opportunity_id: pick.hook.opportunity_id, title: pick.hook.title, what_happened: pick.hook.what_happened, outlet: pick.hook.outlet, published_date: pick.hook.published_date, source_url: pick.hook.source_url, why_m91: pick.hook.why_m91 } : null },
    runners_up: runnersUp,
    signals: { counts: signalCounts(signals), questions: signals.questions.map(({ id, question, source_url, where, posted_date }) => ({ id, question, source_url, where, posted_date })), news: signals.news.map(({ id, title, source_url, published_date }) => ({ id, title, source_url, published_date })), changes: signals.changes.map(({ id, name }) => ({ id, name })) },
    brief_id: ''
  }
  const rec = await store.createRecord({ type: 'weekly_pick', briefId: null, payload, status: 'chosen', date: today })
  emit('step.output', { agent: 'editor', step: 'editor', message: `This week: "${pick.title}" (${pick.format}${pick.hook ? `, hook: ${pick.hook.title}` : ''}): ${reason}`, data: { pick_id: payload.pick_id, record_id: rec.id, chosen_by: chosenBy, runners_up: runnersUp.length, counts: payload.signals.counts } })
  return { pick: { ...payload.pick, pick_id: payload.pick_id, record_id: rec.id }, runners_up: runnersUp, reason, chosen_by: chosenBy, record_id: rec.id, model, warnings }
}

/** Links the pick to the brief written from it (the post page finds the reason by brief id). Never throws. */
export async function linkPick(store, recordId, briefId) {
  try {
    const rec = await store.getRecord(recordId)
    if (rec) await store.updateRecord(rec.id, { ...rec.payload, brief_id: briefId }, { status: 'written' }, { known: rec })
  } catch {
    // The pick stays unlinked; the brief carries its own copy of the reason.
  }
}

/** The weekly_pick of a brief (its reason and runners-up), or null. */
export async function pickOfBrief(store, briefId) {
  return (await store.getRecords({ type: 'weekly_pick' })).find((r) => r.payload?.brief_id === briefId)?.payload ?? null
}
