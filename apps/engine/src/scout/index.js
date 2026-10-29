// The Scout (Phase 2): research mode and sources mode. See docs/ and the Phase 2 brief.

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istDate, istIso } from '../util/time.js'
import { newBriefId, newRecordId, newScoutThreadId } from '../util/ids.js'
import { createViaSocketClient, AiError, TruncatedError } from '../viasocket.js'
import { SCOUT_BASE, FACTS, QUESTIONS, STORIES, TIMELY, TUTORIALS, CLUSTERS, STYLE, SOURCES, SLOT_QUESTIONS, SLOT_SOURCES, WEEK_QUESTIONS, SCHEMA_RETRY_NOTE, TOPIC_GROUPS, MESSAGE_MAX, buildPrompt, fitMessage } from './prompts.js'
import { SCHEMAS, scout_m91_facts_inline } from './schemas.js'
import { limiter, validateAgainst, createUrlChecker, normaliseUrl, isKeptStatus, protectFields, removeLongQuotes, storyDateRule, freshnessFromDates, daysAgo } from './checks.js'
import { buildDocsBundle, fetchSkillReadme, DocsError } from './docs.js'
import { classifyCluster, mergeClusterPayload, storedStoryUrls, isDuplicateTutorial } from './dedupe.js'
import { rankClusters } from './rank.js'
import { emit, scoutStepName, throwIfCancelled, CancelledError } from '../events.js'
import { saveRunLog } from '../util/runlog.js'
import { dedupeSettings, similarity } from '../dedupe.js'
import { expireOld, listOpportunities } from '../timely/model.js'

/** An error that fails the pipeline run (brief 13). */
export class ScoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ScoutError'
  }
}
class BudgetError extends Error {}

// Errors no retry or other call can get past: fail the run.
const FATAL_KINDS = ['config', 'token', 'billing']
/** Phase 9 B3: the stories call asks for at most this many (a long list made it hit the 300 s timeout). */
export const STORIES_MAX = 5
/** The timely lane: the news check asks for at most this many events. */
export const TIMELY_MAX = 5
const urlKey = (u) => String(u).trim().replace(/\/+$/, '').toLowerCase()
const daysBetweenIso = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000

/**
 * @param {{ mode: 'research'|'sources', runId?, briefId?, version?, claims?, reviewerNote? }} params
 * @param {{ config?, store, notifier, aiSend?, fetch?, now?, urlChecker? }} deps
 */
export async function runScout(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const sc = config.scout
  const today = istDate(new Date(now()))
  const runId = params.runId ?? params.briefId ?? newBriefId(new Date(now()))
  const checker = deps.urlChecker ?? createUrlChecker({ fetch: fetchImpl, timeoutMs: sc.urlCheckTimeoutMs })
  const warnings = []
  const calls = []
  let callsUsed = 0
  let deadLinks = 0

  const baseValues = { today }

  // ---------- AI calls: budget, schema retry, truncation retry, run_log ----------

  async function callAi(call, { task, values = {}, sections = {}, schema, delivery, fewer, fallbackSchema, timeoutMs }) {
    let prompt = buildPrompt(task, { ...baseValues, ...values })
    const fitted = fitMessage({ today, ...sections })
    const message = fitted.message
    if (fitted.trimmed.length) warnings.push(`${call}: message cut to ${MESSAGE_MAX} characters (${fitted.trimmed.join(', ')})`)
    let retries = 0
    let schemaRetried = false
    let truncRetried = false
    let fallbackUsed = false
    let activeSchema = schema
    const started = now()
    const meta = () => ({ call, model: sc.model, delivery: delivery ?? sc.delivery, ms: now() - started, retries })
    throwIfCancelled()
    emit('step.started', { agent: 'scout', step: scoutStepName(call) })

    for (;;) {
      if (callsUsed >= sc.maxCalls) throw Object.assign(new BudgetError(`SCOUT_MAX_CALLS (${sc.maxCalls}) reached before ${call}`), { meta: meta() })
      callsUsed++
      try {
        const r = await aiSend({
          agent: 'scout',
          prompt,
          message,
          jsonSchema: activeSchema,
          threadId: newScoutThreadId(runId, call),
          delivery: delivery ?? sc.delivery,
          ...(timeoutMs && { timeoutMs }),
          retries: Math.max(0, Math.min(config.viasocket.maxRetries ?? 3, sc.maxCalls - callsUsed)),
          onRetry: () => { callsUsed++; retries++ }
        })
        const v = validateAgainst(activeSchema.name, r.content)
        if (v.valid) return { value: v.value, meta: { ...meta(), model: r.model ?? sc.model, delivery: r.delivery ?? delivery ?? sc.delivery } }
        if (schemaRetried || callsUsed >= sc.maxCalls) throw new AiError(`answer did not match ${activeSchema.name}: ${v.errors.slice(0, 3).join('; ')}`, { kind: 'schema' })
        schemaRetried = true
        retries++
        prompt = `${prompt}\n\n${SCHEMA_RETRY_NOTE}`
      } catch (error) {
        const budgetLeft = callsUsed < sc.maxCalls
        if (error instanceof TruncatedError && fewer && !truncRetried && budgetLeft) {
          truncRetried = true
          retries++
          prompt = `${buildPrompt(task, { ...baseValues, ...values, ...fewer.values })}\n\n${fewer.note}`
          continue
        }
        if (error?.kind === 'parse' && !schemaRetried && budgetLeft) {
          schemaRetried = true
          retries++
          prompt = `${prompt}\n\n${SCHEMA_RETRY_NOTE}`
          continue
        }
        if (error?.kind === 'bad_request' && /schema|\$defs|\$ref/i.test(error.message) && fallbackSchema && !fallbackUsed && budgetLeft) {
          fallbackUsed = true
          retries++
          activeSchema = fallbackSchema
          warnings.push(`${call}: API refused the schema; retried with the inline version`)
          continue
        }
        error.meta = meta()
        throw error
      }
    }
  }

  async function runLog(meta, { returned = 0, kept = 0, dropped = 0, error = null, details = [] } = {}) {
    const entry = {
      run_id: runId, agent: 'scout', call: meta.call, model: meta.model, delivery: meta.delivery, ms: meta.ms,
      items_returned: returned, items_kept: kept, items_dropped: dropped, retries: meta.retries, error, time: istIso(new Date(now()))
    }
    calls.push(entry)
    log.info('scout call', entry)
    if (meta.call !== 'research_summary') {
      const step = scoutStepName(meta.call)
      emit(error ? 'step.failed' : 'step.finished', { agent: 'scout', step, ...(error && { message: error }), data: { ms: meta.ms, retries: meta.retries, model: meta.model, delivery: meta.delivery } })
      // Phase 9 B4: dropped items are named with their reason (tutorials).
      const why = details.length ? `: ${details.map((d) => `"${d.title}" (${d.reason})`).join('; ')}` : ''
      if (!error) emit('step.output', { agent: 'scout', step, message: `${kept} kept of ${returned} returned${dropped ? ` (${dropped} dropped)` : ''}${why}`, data: { returned, kept, dropped, ...(details.length && { dropped_items: details }) } })
    }
    try {
      await saveRunLog(store, { briefId: runId, payload: entry, status: error ? 'error' : 'ok' })
    } catch (e) {
      log.error('could not write scout run_log', { error: e })
    }
  }

  /** Runs a call; a non-fatal failure becomes a warning (and a run_log) and returns null. */
  async function tryCall(call, opts) {
    try {
      return await callAi(call, opts)
    } catch (error) {
      if (error instanceof CancelledError) throw error
      await runLog(error.meta ?? { call, model: sc.model, delivery: opts.delivery ?? sc.delivery, ms: 0, retries: 0 }, { error: error.message })
      if (FATAL_KINDS.includes(error?.kind)) throw new ScoutError(`${call}: ${error.message}`)
      warnings.push(`${call} failed: ${error.message}`)
      return null
    }
  }

  // ---------- URL helpers ----------

  /** Normalised URL + status; counts dead links. Returns null when the item must be dropped. */
  async function liveUrl(raw) {
    const url = normaliseUrl(raw, sc.docsHosts)
    if (!url) {
      deadLinks++
      return null
    }
    const status = await checker.check(url)
    if (!isKeptStatus(status)) {
      deadLinks++
      return null
    }
    return { url, status }
  }

  if (params.mode === 'sources') return sourcesMode()
  // The timely lane: one news-check call; saves timely_opportunity cards for the person to decide on.
  if (params.mode === 'timely') return timelyMode()
  // One post only (the weekly editor's pick, a due pinned topic or a Write now card): its questions and sources
  // (+ tutorial steps for a tutorial).
  if (params.mode === 'slot') return slotMode()
  // The weekly editor's input: the questions people asked recently (1 web-search call).
  if (params.mode === 'week') return weekMode()
  // The facts step alone; today's record is reused.
  if (params.mode === 'facts') {
    const f = await getFacts()
    return { mode: 'facts', facts_record_id: f.id, facts: f.payload, reused: f.reused, calls_used: callsUsed, warnings, calls }
  }
  if (params.mode !== 'research') throw new ScoutError(`unknown Scout mode "${params.mode}"`)
  return researchMode()

  // ======================= timely mode (the news check) =======================

  /**
   * One web-search call for real events of the last TIMELY_WINDOW_DAYS where M91 genuinely helps. Code keeps an
   * event only when its date is inside the window, its source loads, and it is not already known (same source
   * URL as a card — a timely post keeps its card — or a title close to a card's or an approved post's). Reads:
   * the cards, the newest facts and the knowledge map (the engine's index serves the cards). Each kept
   * event becomes a "proposed" timely_opportunity. Cards past their window expire first. The newest M91 facts
   * are used as they are (a facts call only when there are none at all).
   */
  async function timelyMode() {
    const windowDays = config.timely?.windowDays ?? 7
    const expired = await expireOld(store, { config, now })
    const current = (await store.getRecords({ type: 'm91_facts', status: 'current' })).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
    const facts = current?.payload ?? (await getFacts()).payload
    const cards = await listOpportunities(store)
    const knownUrls = new Set(cards.map((c) => urlKey(c.payload?.source_url ?? '')))
    knownUrls.delete('')
    const knownTitles = [
      ...cards.map((c) => ({ title: c.payload?.title ?? '', what: 'a timely card' })),
      ...(await store.getRecords({ type: 'knowledge' })).map((k) => ({ title: k.payload?.title ?? '', what: 'an approved post' }))
    ].filter((t) => t.title)
    const threshold = dedupeSettings(config).threshold
    const knownList = cards.filter((c) => c.status !== 'expired').map((c) => `- ${c.payload?.title} (${c.payload?.source_url})`).slice(0, 30).join('\n') || 'none'

    const res = await callAi('timely', {
      task: TIMELY,
      values: { window_days: windowDays, events_max: TIMELY_MAX },
      sections: { facts: summariseFacts(facts), knownEvents: knownList },
      schema: SCHEMAS.scout_timely,
      delivery: sc.researchDelivery,
      fewer: { values: { events_max: 2 }, note: 'Your last answer was cut off. Return at most 2 events.' },
      timeoutMs: sc.storiesTimeoutMs
    })
    const returned = res.value.events.slice(0, TIMELY_MAX)
    if (res.value.events.length > TIMELY_MAX) warnings.push(`timely: ${res.value.events.length} events returned, kept the first ${TIMELY_MAX}`)
    const kept = []
    const dropped = []
    for (const e of returned) {
      const drop = (reason) => dropped.push({ title: e.title, reason })
      const age = daysAgo(e.published_date, today)
      if (age === null) { drop('no clear date'); continue }
      if (age < 0) { drop(`dated in the future (${e.published_date})`); continue }
      if (age > windowDays) { drop(`${age} days old (window ${windowDays})`); continue }
      const live = await liveUrl(e.source_url)
      if (!live) { drop('the source does not load'); continue }
      if (knownUrls.has(urlKey(live.url))) { drop('already known (same source)'); continue }
      const close = knownTitles.find((t) => similarity(e.title, t.title) >= threshold)
      if (close) { drop(`close to ${close.what}: "${close.title}"`); continue }
      const quotes = protectFields(e, ['what_happened', 'why_m91', 'urgency_reason'], ['title'])
      if (quotes) warnings.push(`timely: removed ${quotes} long quote(s) from "${e.title}"`)
      const payload = {
        opportunity_id: newRecordId('O', new Date(now())), title: e.title, what_happened: e.what_happened, source_url: live.url, outlet: e.outlet,
        published_date: e.published_date, why_m91: e.why_m91, urgency: e.urgency, urgency_reason: e.urgency_reason, topic_group: e.topic_group,
        url_status: live.status, found_at: istIso(new Date(now())), found_by_run: runId, brief_id: ''
      }
      const rec = await store.createRecord({ type: 'timely_opportunity', briefId: null, payload, status: 'proposed', topicGroup: e.topic_group, date: today })
      kept.push({ ...payload, record_id: rec.id })
      knownUrls.add(urlKey(live.url))
      knownTitles.push({ title: e.title, what: 'a timely card' })
    }
    await runLog(res.meta, { returned: returned.length, kept: kept.length, dropped: dropped.length, details: dropped })
    return { mode: 'timely', run_id: runId, opportunities: kept, dropped, expired, counts: { returned: returned.length, kept: kept.length, dropped: dropped.length, expired }, calls_used: callsUsed, warnings, calls }
  }

  // ======================= week mode (the weekly editor's questions) =======================

  /**
   * One web-search call: real questions people asked in the last EDITOR_QUESTION_DAYS days, across every topic
   * group. Code keeps a question only when its page loads, its date (if shown) is inside the window, and it is not
   * a near-duplicate of another one. Nothing is saved: the editor's weekly_pick record keeps what it used.
   */
  async function weekMode() {
    const ec = config.editor ?? {}
    const days = ec.questionDays ?? 21
    const max = ec.questionsMax ?? 12
    const current = (await store.getRecords({ type: 'm91_facts', status: 'current' })).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
    const facts = current?.payload ?? (await getFacts()).payload
    const res = await callAi('questions-week', {
      task: WEEK_QUESTIONS,
      values: { days, questions_max: max, topic_groups: Object.entries(TOPIC_GROUPS).map(([n, t]) => `${n}. ${t}`).join('\n') },
      sections: { facts: summariseFacts(facts) },
      schema: SCHEMAS.scout_week_questions,
      delivery: sc.researchDelivery,
      fewer: { values: { questions_max: Math.max(3, Math.floor(max / 2)) }, note: 'Your last answer was cut off. Return fewer questions.' },
      timeoutMs: sc.questionsTimeoutMs
    })
    const returned = res.value.questions.slice(0, max)
    const kept = []
    const dropped = []
    for (const q of returned) {
      const drop = (reason) => dropped.push({ title: q.question, reason })
      const age = q.posted_date ? daysAgo(q.posted_date, today) : null
      if (age !== null && (age < 0 || age > days)) { drop(`${age} days old (window ${days})`); continue }
      if (kept.some((k) => similarity(k.question, q.question) >= 0.8)) { drop('a near-duplicate of another question'); continue }
      const live = await liveUrl(q.source_url)
      if (!live) { drop('the page does not load'); continue }
      protectFields(q, [], ['question', 'demand_evidence'])
      kept.push({ question: q.question, source_url: live.url, where: q.where, posted_date: q.posted_date, demand_evidence: q.demand_evidence, topic_group: q.topic_group })
    }
    await runLog(res.meta, { returned: returned.length, kept: kept.length, dropped: dropped.length, details: dropped })
    return { mode: 'week', run_id: runId, questions: kept, dropped, counts: { returned: returned.length, kept: kept.length, dropped: dropped.length }, calls_used: callsUsed, warnings, calls }
  }

  // ======================= slot mode: one post =======================

  /**
   * The focused Scout: research only the post this run writes (params.target: { kind: 'weekly', pick } from the
   * weekly editor, { kind: 'pinned', pin } or { kind: 'timely', opportunity }). About 2 AI calls (questions,
   * sources), +1 for the facts when today's are not there yet, +1 for tutorial steps when the post is a tutorial.
   * Saves: one question_cluster, one source_pack (for the run's brief id), and a tutorial_lead for a tutorial.
   */
  async function slotMode() {
    const t = params.target
    if (!t || !['weekly', 'pinned', 'timely'].includes(t.kind)) throw new ScoutError('slot mode needs a target (the weekly pick, a pinned topic or a timely opportunity)')
    // A Write now card: the post is about one real event. The weekly pick may open with a news hook.
    const opp = t.kind === 'timely' ? t.opportunity : null
    const pick = t.kind === 'weekly' ? t.pick : null
    const hook = pick?.hook ?? null
    const slot = pick ? { title_idea: pick.title, question: pick.question }
      : opp ? { title_idea: opp.title, question: `What does "${opp.title}" mean for teams that need a person to decide in time?` }
      : { title_idea: t.pin.topic, question: /\?$/.test(t.pin.topic) ? t.pin.topic : `${t.pin.topic}?` }
    const tutorial = pick?.format === 'tutorial'
    const factsResult = await getFacts()
    const facts = factsResult.payload
    const factsSummary = summariseFacts(facts)
    const slotText = [
      `Question: ${slot.question}`,
      `Working title: ${slot.title_idea}`,
      pick ? `Format: ${pick.format}. Angle: ${pick.angle}. Why this week: ${pick.why_now}` : opp ? 'A timely post about a real event' : 'A pinned topic',
      pick?.evidence?.length ? `Why readers need it: ${pick.evidence.filter((e) => e.kind !== 'news').map((e) => `${e.text}${e.url ? ` (${e.url})` : ''}`).join('; ')}` : null,
      t.kind === 'pinned' && t.pin.notes ? `Notes: ${t.pin.notes}` : null,
      opp ? `Event: ${opp.what_happened} Reported by ${opp.outlet} on ${opp.published_date}: ${opp.source_url}\nWhy M91 helps: ${opp.why_m91}` : null,
      hook ? `This week's hook (the intro opens with it): ${hook.what_happened} Reported by ${hook.outlet} on ${hook.published_date}: ${hook.source_url}` : null
    ].filter(Boolean).join('\n')

    // 1. The real questions about this post (web).
    const qRes = await callAi('questions-slot', {
      task: SLOT_QUESTIONS,
      values: { questions_max: sc.questionsPerGroup },
      sections: { facts: factsSummary, slot: slotText },
      schema: SCHEMAS.scout_slot_questions,
      delivery: sc.researchDelivery,
      fewer: { values: { questions_max: Math.max(1, Math.floor(sc.questionsPerGroup / 2)) }, note: 'Your last answer was cut off. Return fewer related questions.' },
      timeoutMs: sc.questionsTimeoutMs
    })
    const related = []
    for (const q of qRes.value.related_questions.slice(0, sc.questionsPerGroup)) {
      const live = await liveUrl(q.source_url)
      if (!live) continue
      protectFields(q, [], ['question', 'demand_evidence'])
      related.push({ ...q, source_url: live.url, url_status: live.status })
    }
    await runLog(qRes.meta, { returned: qRes.value.related_questions.length, kept: related.length, dropped: qRes.value.related_questions.length - related.length })
    const clusterPayload = {
      cluster_id: newRecordId('C', new Date(now())), main_question: qRes.value.main_question || slot.question, related_questions: related.map((q) => q.question),
      // The pages where people asked are sources the Strategist may cite (like a research cluster's).
      questions: related, source_urls: related.map((q) => q.source_url), demand: qRes.value.demand, pick_id: pick?.pick_id ?? null, pinned_id: t.kind === 'pinned' ? t.pin.pinned_id : null,
      opportunity_id: opp?.opportunity_id ?? null,
      title_idea: slot.title_idea, m91_fit: { score: 5, reason: pick ? `the weekly editor's pick: ${pick.why_now}` : opp ? 'a timely opportunity you chose' : 'a pinned topic' }
    }
    const clusterRec = await store.createRecord({ type: 'question_cluster', briefId: null, payload: clusterPayload, status: 'open', date: today })

    // 2. Sources a writer can cite for it (web).
    // A failed sources call is a warning: the post can still be planned from the M91 facts.
    const sRes = await tryCall('sources-slot', {
      task: SLOT_SOURCES,
      values: { sources_max: 6 },
      sections: { facts: factsSummary, slot: slotText },
      schema: SCHEMAS.scout_slot_sources,
      delivery: sc.researchDelivery
    })
    const results = []
    for (const s of (sRes?.value.sources ?? []).slice(0, 6)) {
      const live = await liveUrl(s.url)
      if (!live) continue
      protectFields(s, [], ['what_it_covers'])
      results.push({ url: live.url, publisher: s.publisher, verdict: 'supports', note: s.what_it_covers, kind: s.kind, url_status: live.status })
    }
    if (sRes) await runLog(sRes.meta, { returned: sRes.value.sources.length, kept: results.length, dropped: sRes.value.sources.length - results.length })
    // The event's own source (a Write now card, or the weekly pick's hook) always comes first (checked again here).
    const event = opp ?? hook
    if (event && !results.some((x) => urlKey(x.url) === urlKey(event.source_url))) {
      const live = await liveUrl(event.source_url)
      if (live) results.unshift({ url: live.url, publisher: event.outlet, verdict: 'supports', note: event.what_happened, kind: 'news', url_status: live.status })
      else warnings.push(`the event's source no longer loads (${event.source_url})`)
    }
    // The questions that showed the demand are sources too (where people asked).
    for (const e of pick?.evidence ?? []) {
      if (e.kind !== 'question' || !e.url || results.some((x) => urlKey(x.url) === urlKey(e.url))) continue
      results.push({ url: e.url, publisher: e.where ?? 'community', verdict: 'supports', note: `people ask: ${e.text}`, kind: 'community', url_status: 200 })
    }
    const packPayload = { brief_id: params.briefId ?? runId, version: null, pick_id: pick?.pick_id ?? null, claims: [{ claim: slot.question, results, verdict: results.length ? 'supported' : 'unverified' }] }
    const packRec = await store.createRecord({ type: 'source_pack', briefId: params.briefId ?? runId, payload: packPayload, status: 'current', date: today })

    // The timely lane: the card becomes the story lead the Strategist plans the rapid-response post from (no AI).
    let storyId = null
    if (opp) {
      const story = {
        story_id: newRecordId('S', new Date(now())), title: opp.title, summary: opp.what_happened, why_it_matters: opp.why_m91, source_url: opp.source_url,
        source_name: opp.outlet, published_date: opp.published_date, attribution_line: `reported by ${opp.outlet}`, topic_group: opp.topic_group,
        url_status: opp.url_status ?? 200, within_rapid_response_window: true, opportunity_id: opp.opportunity_id
      }
      await store.createRecord({ type: 'story_lead', briefId: null, payload: story, status: 'open', topicGroup: opp.topic_group, date: today })
      storyId = story.story_id
    }

    // 3. A tutorial: its steps, only from the M91 docs and the skill repository.
    const tutorialIds = []
    if (tutorial) {
      const readme = await fetchSkillReadme({ repoUrl: config.m91.skillRepoUrl, fetch: fetchImpl })
      const tRes = await tryCall('tutorials', {
        task: `${TUTORIALS}\n\nOnly ideas for this post: ${slot.question} (return at most 2).`,
        sections: { facts: summariseFacts(facts, { only: ['can', 'integrations'] }), skillRepo: readme.text ?? `(README not available) ${config.m91.skillRepoUrl}`, slot: slotText },
        schema: SCHEMAS.scout_tutorials,
        delivery: sc.delivery,
        fewer: { values: {}, note: 'Your last answer was cut off. Return at most 1 tutorial idea.' }
      })
      for (const idea of (tRes?.value.tutorials ?? []).slice(0, 2)) {
        const payload = { tutorial_id: newRecordId('T', new Date(now())), ...idea, pick_id: pick?.pick_id ?? null }
        await store.createRecord({ type: 'tutorial_lead', briefId: null, payload, status: 'open', topicGroup: idea.topic_group ?? null, date: today })
        tutorialIds.push(payload.tutorial_id)
      }
      if (tRes) await runLog(tRes.meta, { returned: tRes.value.tutorials?.length ?? 0, kept: tutorialIds.length, dropped: 0 })
    }

    return {
      mode: 'slot', run_id: runId, target: { kind: t.kind, pick_id: pick?.pick_id ?? null, opportunity_id: opp?.opportunity_id ?? null }, story_id: storyId,
      facts_record_id: factsResult.id, facts_reused: factsResult.reused, cluster_id: clusterPayload.cluster_id, cluster_record_id: clusterRec.id,
      cluster_ids: [clusterPayload.cluster_id], source_pack_id: packRec.id, sources: results.length, tutorial_ids: tutorialIds,
      top_clusters: [{ cluster_id: clusterPayload.cluster_id, main_question: clusterPayload.main_question }],
      counts: { questions: related.length, clusters_new: 1, clusters_merged: 0, stories: 0, tutorials: tutorialIds.length, sources: results.length },
      calls_used: callsUsed, warnings, calls
    }
  }

  // ======================= research mode =======================

  async function researchMode() {
    const dedupe = dedupeSettings(config)
    const counts = { questions: 0, clusters_new: 0, clusters_merged: 0, stories: 0, tutorials: 0, dropped_dead_links: 0 }
    await housekeeping()

    const factsResult = await getFacts()
    const facts = factsResult.payload
    const factsSummary = summariseFacts(facts)
    const reuse = await shouldReuse(factsResult)

    // The question groups, stories and tutorials need only the facts, not each other: their AI calls run at
    // the same time (at most SCOUT_CONCURRENCY), and their answers are processed below in the usual order,
    // so the saved records come out the same. Each call keeps its own timeout, budget and retry rules.
    const gate = limiter(sc.concurrency ?? 7)
    const started = (fn) => {
      const p = gate(fn)
      p.catch(() => {}) // handled where it is awaited; this only avoids an unhandled rejection meanwhile
      return p
    }
    const alreadyCovered = reuse.reuse ? null : await alreadyCoveredList()
    const questionCalls = reuse.reuse ? [] : sc.questionGroups.map((group) => [group, started(() => tryCall(`questions-${group}`, {
      task: QUESTIONS,
      values: { topic_group_number: group, topic_group_text: TOPIC_GROUPS[group], competitors: sc.competitors.join(', '), questions_per_group: sc.questionsPerGroup },
      sections: { facts: factsSummary, alreadyCovered, competitors: sc.competitors.join(', ') },
      schema: SCHEMAS.scout_questions,
      delivery: sc.researchDelivery,
      fewer: { values: { questions_per_group: Math.max(1, Math.floor(sc.questionsPerGroup / 2)) }, note: `Your last answer was cut off. Return at most ${Math.max(1, Math.floor(sc.questionsPerGroup / 2))} questions.` },
      timeoutMs: sc.questionsTimeoutMs
    }))])
    const storiesCall = started(() => tryCall('stories', {
      task: STORIES,
      values: { story_lookback_days: sc.storyLookbackDays, rapid_response_days: sc.rapidResponseDays, stories_max: STORIES_MAX },
      sections: { facts: factsSummary },
      schema: SCHEMAS.scout_stories,
      delivery: sc.researchDelivery,
      // Its own timeout (SCOUT_STORIES_TIMEOUT_MS): a web search for stories can take longer than the others.
      // A timeout stays a warning: the run goes on without new stories.
      timeoutMs: sc.storiesTimeoutMs
    }))
    const tutorialsCall = reuse.reuse ? null : started(async () => {
      const readme = await fetchSkillReadme({ repoUrl: config.m91.skillRepoUrl, fetch: fetchImpl })
      const res = await tryCall('tutorials', {
        task: TUTORIALS,
        sections: { facts: summariseFacts(facts, { only: ['can', 'integrations'] }), skillRepo: readme.text ?? `(README not available) ${config.m91.skillRepoUrl}` },
        schema: SCHEMAS.scout_tutorials,
        delivery: sc.delivery,
        fewer: { values: {}, note: 'Your last answer was cut off. Return at most 3 tutorial ideas.' }
      })
      return { readme, res }
    })

    // Questions
    const questions = []
    if (!reuse.reuse) {
      for (const [group, call] of questionCalls) {
        const res = await call
        if (!res) continue
        const returned = res.value.questions
        const kept = []
        for (const q of returned.slice(0, sc.questionsPerGroup)) {
          const live = await liveUrl(q.source_url)
          if (!live) continue
          protectFields(q, [], ['question', 'demand_evidence', 'm91_help'])
          kept.push({ ...q, source_url: live.url, url_status: live.status, topic_group: group })
        }
        questions.push(...kept)
        await runLog(res.meta, { returned: returned.length, kept: kept.length, dropped: returned.length - kept.length })
      }
      counts.questions = questions.length
    }

    // Stories
    const storyIds = []
    const rapidIds = []
    const newStories = []
    {
      const res = await storiesCall
      if (res) {
        const known = await storedStoryUrls(store)
        const returned = res.value.stories.slice(0, STORIES_MAX)
        if (res.value.stories.length > STORIES_MAX) warnings.push(`stories: ${res.value.stories.length} returned, kept the first ${STORIES_MAX}`)
        for (const s of returned) {
          const rule = storyDateRule(s.published_date, { today, lookbackDays: sc.storyLookbackDays, rapidDays: sc.rapidResponseDays })
          if (!rule.keep) continue
          const live = await liveUrl(s.source_url)
          if (!live || known.has(live.url)) continue
          known.add(live.url)
          const quotes = protectFields(s, ['summary', 'why_it_matters'], ['title', 'attribution_line'])
          if (quotes) warnings.push(`stories: removed ${quotes} long quote(s) from "${s.title}"`)
          const payload = { story_id: newRecordId('S', new Date(now())), ...s, source_url: live.url, url_status: live.status, within_rapid_response_window: rule.rapid }
          const rec = await store.createRecord({ type: 'story_lead', briefId: null, payload, status: 'open', topicGroup: s.topic_group, date: today })
          newStories.push({ ...payload, id: rec.id })
          storyIds.push(payload.story_id)
          if (rule.rapid) rapidIds.push(payload.story_id)
        }
        counts.stories = newStories.length
        await runLog(res.meta, { returned: returned.length, kept: newStories.length, dropped: returned.length - newStories.length })
      }
    }

    // Tutorials (skipped when reusing research)
    const tutorialIds = []
    const newTutorials = []
    if (!reuse.reuse) {
      const { readme, res } = await tutorialsCall
      if (readme.warning) warnings.push(readme.warning)
      const repoPrefix = urlKey(readme.url ?? config.m91.skillRepoUrl)
      const allowed = new Set((facts.sources ?? []).map(urlKey))
      const isAllowed = (u) => allowed.has(urlKey(u)) || urlKey(u).startsWith(repoPrefix)
      // Phase 9 B4: the docs moved hosts (m91.msg91.com → m91-api.msg91.com). A docs link on any docs host whose
      // path is in today's bundle means that bundle page, so it maps to the bundle's URL instead of being dropped.
      const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '').toLowerCase() } catch { return null } }
      const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase() } catch { return null } }
      const bundleByPath = new Map((facts.sources ?? []).map((u) => [pathOf(u), u]))
      const toAllowed = (u) => (isAllowed(u) ? u : sc.docsHosts.includes(hostOf(u)) ? bundleByPath.get(pathOf(u)) ?? null : null)
      const droppedTutorials = []
      if (res) {
        const returned = res.value.tutorials
        for (const t of returned) {
          const steps = []
          let lost = null
          for (const [i, step] of t.steps_outline.entries()) {
            const raw = normaliseUrl(step.source_url, sc.docsHosts)
            const url = raw && toAllowed(raw)
            if (!url) { lost = `step ${i + 1} cites ${step.source_url ?? '(no URL)'}, which is not in today's docs or the skill repo`; break }
            const live = await liveUrl(url)
            if (!live) { lost = `step ${i + 1}'s page ${url} does not load`; break }
            steps.push({ ...step, source_url: live.url })
          }
          if (lost || steps.length === 0) {
            droppedTutorials.push({ title: t.title, reason: lost ?? 'no steps' })
            continue
          }
          const supporting = []
          for (const f of t.supporting_facts) {
            const raw = normaliseUrl(f.source_url, sc.docsHosts)
            const url = raw && toAllowed(raw)
            if (url) supporting.push({ ...f, source_url: url })
          }
          protectFields(t, [], ['reader_outcome'])
          if (await isDuplicateTutorial(store, t, dedupe.threshold, dedupe.mode)) {
            droppedTutorials.push({ title: t.title, reason: 'a similar tutorial for the same target already exists' })
            continue
          }
          const payload = { tutorial_id: newRecordId('T', new Date(now())), ...t, supporting_facts: supporting, steps_outline: steps }
          const rec = await store.createRecord({ type: 'tutorial_lead', briefId: null, payload, status: 'open', topicGroup: t.topic_group, date: today })
          newTutorials.push({ ...payload, id: rec.id })
          tutorialIds.push(payload.tutorial_id)
        }
        counts.tutorials = newTutorials.length
        for (const d of droppedTutorials) warnings.push(`tutorials: dropped "${d.title}": ${d.reason}`)
        await runLog(res.meta, { returned: returned.length, kept: newTutorials.length, dropped: returned.length - newTutorials.length, details: droppedTutorials })
      }
    }

    // Clusters + dedupe (skipped when reusing research)
    const clusterIds = []
    const newClusterRecords = []
    // Phase 9 A2: one write per cluster. Merges are collected (several merges into one cluster → one update),
    // and new clusters are created after ranking, with their rank already set.
    const pendingMerges = new Map()
    const pendingNew = []
    if (!reuse.reuse && questions.length) {
      const res = await tryCall('clusters', {
        task: CLUSTERS,
        sections: {
          facts: factsSummary,
          questions: JSON.stringify(questions.map(({ question, source_url, demand_evidence, date_seen, reader_type, intent, topic_group }) => ({ question, source_url, demand_evidence, date_seen, reader_type, intent, topic_group })))
        },
        schema: SCHEMAS.scout_clusters,
        delivery: sc.delivery
      })
      if (res) {
        const dateByUrl = new Map(questions.map((q) => [urlKey(q.source_url), q.date_seen]))
        const returned = res.value.clusters
        let kept = 0
        for (const c of returned) {
          const urls = []
          for (const raw of c.source_urls) {
            const live = await liveUrl(raw)
            if (live && !urls.some((u) => u.url === live.url)) urls.push({ url: live.url, url_status: live.status })
          }
          if (!urls.length) continue
          kept++
          protectFields(c.demand, [], ['reason'])
          protectFields(c.m91_fit, [], ['reason'])
          const cluster = { ...c, source_urls: urls, freshness: freshnessFromDates(urls.map((u) => dateByUrl.get(urlKey(u.url))).filter(Boolean), today) }
          const decision = await classifyCluster(store, cluster, dedupe.threshold, dedupe.mode)
          if (decision.action === 'merge') {
            pendingMerges.set(decision.match.id, mergeClusterPayload(pendingMerges.get(decision.match.id) ?? decision.match.payload, cluster, today))
            counts.clusters_merged++
            continue
          }
          const payload = {
            cluster_id: newRecordId('C', new Date(now())),
            ...cluster,
            already_covered_by: decision.action === 'covered' ? decision.coveredBy : null,
            update_candidate: decision.action === 'covered',
            rank_score: null,
            first_seen: today,
            last_seen: today
          }
          pendingNew.push({ tempId: `new:${pendingNew.length}`, payload, topicGroup: c.topic_group })
          clusterIds.push(payload.cluster_id)
          counts.clusters_new++
        }
        await runLog(res.meta, { returned: returned.length, kept, dropped: returned.length - kept })
      }
    }

    // Rank all open clusters
    const stored = (await store.getRecords({ type: 'question_cluster', status: 'open' })).map((r) => ({ id: r.id, payload: r.payload }))
    const openClusters = [...stored.map((o) => ({ id: o.id, payload: pendingMerges.get(o.id) ?? o.payload })), ...pendingNew.map((n) => ({ id: n.tempId, payload: n.payload }))]
    const recentGroups = (await store.getRecords({ type: 'brief' }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10)
      .map((b) => b.topicGroup ?? b.payload?.topic_group)
      .filter((g) => g != null)
    const ranked = rankClusters(openClusters.map((c) => ({ ...c.payload, _id: c.id })), recentGroups)
    for (const c of ranked) {
      const { _id, ...payload } = c
      const fresh = pendingNew.find((n) => n.tempId === _id)
      if (fresh) {
        const rec = await store.createRecord({ type: 'question_cluster', briefId: null, payload, status: 'open', topicGroup: fresh.topicGroup, date: today })
        newClusterRecords.push({ id: rec.id, payload })
        continue
      }
      const before = stored.find((o) => o.id === _id)?.payload
      if (pendingMerges.has(_id) || before?.rank_score !== c.rank_score) await store.updateRecord(_id, payload, {})
    }
    const top = ranked[0] ?? null

    // Style notes for the top topic
    let styleProfileId = null
    let newTone = null
    let styleSources = []
    if (top) {
      const group = Number(top.topic_group)
      const profiles = (await store.getRecords({ type: 'tone_profile', status: 'current' })).filter((p) => Number(p.topicGroup ?? p.payload?.topic_group) === group)
      const fresh = profiles.find((p) => p.date && daysBetweenIso(`${p.date}T00:00:00Z`, `${today}T00:00:00Z`) <= sc.styleReuseDays)
      if (fresh) {
        styleProfileId = fresh.payload?.profile_id ?? null
        styleSources = fresh.payload?.based_on ?? []
      } else {
        const res = await tryCall('style', {
          task: STYLE,
          values: { style_topic: top.main_question },
          schema: SCHEMAS.scout_style,
          delivery: sc.researchDelivery,
          fewer: { values: {}, note: 'Your last answer was cut off. Use only 3 articles and keep each note short.' }
        })
        if (res) {
          const returned = res.value.based_on
          const basedOn = []
          for (const a of returned) {
            const live = await liveUrl(a.url)
            if (live) basedOn.push({ ...a, url: live.url, url_status: live.status })
          }
          let quotes = 0
          for (const k of Object.keys(res.value.notes)) {
            if (typeof res.value.notes[k] === 'string') {
              const r = removeLongQuotes(res.value.notes[k])
              res.value.notes[k] = r.text
              quotes += r.removed
            }
          }
          res.value.notes.avoid = res.value.notes.avoid.map((x) => removeLongQuotes(x).text)
          if (quotes) warnings.push(`style: removed ${quotes} long quote(s) from the notes`)
          if (basedOn.length) {
            for (const p of profiles) await store.updateRecord(p.id, undefined, { status: 'old' })
            const payload = { profile_id: newRecordId('P', new Date(now())), topic: res.value.topic, topic_group: group, based_on: basedOn, notes: res.value.notes, kind: 'style_notes' }
            const toneRec = await store.createRecord({ type: 'tone_profile', briefId: null, payload, status: 'current', topicGroup: group, date: today })
            newTone = { id: toneRec.id, payload, group }
            styleProfileId = payload.profile_id
            styleSources = basedOn
          } else {
            warnings.push('style: no article URL loaded; style notes not saved')
          }
          await runLog(res.meta, { returned: returned.length, kept: basedOn.length, dropped: returned.length - basedOn.length })
        }
      }
    }

    // Fail rule: nothing usable at all
    const openStories = (await store.getRecords({ type: 'story_lead', status: 'open' })).length + (store.dryRun ? newStories.length : 0)
    const openTutorials = (await store.getRecords({ type: 'tutorial_lead', status: 'open' })).length + (store.dryRun ? newTutorials.length : 0)
    counts.dropped_dead_links = deadLinks
    if (openClusters.length === 0 && openStories === 0 && openTutorials === 0) {
      throw new ScoutError('Scout found nothing usable: 0 open clusters, 0 open story leads and 0 open tutorial leads')
    }

    const result = {
      mode: 'research',
      run_id: runId,
      reused: reuse.reuse,
      facts_record_id: factsResult.id,
      cluster_ids: clusterIds,
      story_ids: storyIds,
      tutorial_ids: tutorialIds,
      style_profile_id: styleProfileId,
      top_clusters: ranked.slice(0, 3).map((c) => ({ cluster_id: c.cluster_id, main_question: c.main_question, rank_score: c.rank_score, topic_group: c.topic_group, m91_fit: c.m91_fit?.score, demand: c.demand?.level })),
      rapid_response_story_ids: rapidIds,
      counts,
      calls_used: callsUsed,
      warnings
    }
    // DRY_RUN saves nothing, so hand this run's records to the next agent in memory (same shape as store records).
    if (store.dryRun) {
      const rec = (type, id, payload, extra = {}) => ({ id, type, status: 'open', date: today, topicGroup: payload.topic_group ?? null, payload, ...extra })
      const rankedById = new Map(ranked.map((c) => [c._id, c]))
      result.dry_run_records = {
        m91_facts: factsResult.reused ? [] : [rec('m91_facts', factsResult.id, factsResult.payload, { status: 'current', topicGroup: null })],
        question_cluster: newClusterRecords.map((c) => { const { _id, ...p } = rankedById.get(c.id) ?? c.payload; return rec('question_cluster', c.id, p) }),
        story_lead: newStories.map(({ id, ...p }) => rec('story_lead', id, p)),
        tutorial_lead: newTutorials.map(({ id, ...p }) => rec('tutorial_lead', id, p)),
        tone_profile: newTone ? [rec('tone_profile', newTone.id, newTone.payload, { status: 'current', topicGroup: newTone.group })] : []
      }
    }
    await runLog({ call: 'research_summary', model: null, delivery: null, ms: 0, retries: 0 }, { returned: calls.length, kept: clusterIds.length + storyIds.length + tutorialIds.length })
    // A finished fresh research: note its time on the facts record (one write; DRY_RUN writes nothing).
    if (!reuse.reuse && !store.dryRun && factsResult.id) {
      try {
        await store.updateRecord(factsResult.id, { ...factsResult.payload, research_at: istIso(new Date(now())) }, {})
      } catch (error) {
        warnings.push(`could not note the research time on the facts record: ${error.message}`)
      }
    }
    await postSummary(result, styleSources)
    return { ...result, calls }
  }

  // ---------- research helpers ----------

  async function housekeeping() {
    try {
      for (const s of await store.getRecords({ type: 'story_lead', status: 'open' })) {
        const rule = storyDateRule(s.payload?.published_date, { today, lookbackDays: sc.storyLookbackDays, rapidDays: sc.rapidResponseDays })
        const storedAge = s.date ? daysBetweenIso(`${s.date}T00:00:00Z`, `${today}T00:00:00Z`) : 0
        if (!rule.keep || (rule.age === null && storedAge > sc.storyLookbackDays)) await store.updateRecord(s.id, undefined, { status: 'expired' })
      }
    } catch (error) {
      warnings.push(`housekeeping: ${error.message}`)
    }
  }

  /** Today's m91_facts record, or a new one built from the docs bundle. Failure fails the run. */
  async function getFacts() {
    const current = await store.getRecords({ type: 'm91_facts', status: 'current' })
    const todays = current.find((r) => r.date === today)
    if (todays) return { id: todays.id, payload: todays.payload, reused: true }

    let bundle
    try {
      bundle = await buildDocsBundle({ docsUrl: config.m91.docsUrl, hosts: sc.docsHosts, maxPages: sc.docsMaxPages, maxChars: sc.docsMaxChars, fetch: fetchImpl })
    } catch (error) {
      if (error instanceof DocsError) throw new ScoutError(error.message)
      throw error
    }
    warnings.push(...bundle.warnings)
    let res
    try {
      res = await callAi('facts', { task: FACTS, sections: { docs: bundle.bundle }, schema: SCHEMAS.scout_m91_facts, fallbackSchema: scout_m91_facts_inline, delivery: sc.delivery })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      await runLog(error.meta ?? { call: 'facts', model: sc.model, delivery: sc.delivery, ms: 0, retries: 0 }, { error: error.message })
      throw new ScoutError(`M91 facts call failed: ${error.message}`)
    }
    const allowed = new Map(bundle.sources.map((u) => [urlKey(u), u]))
    const inBundle = (raw) => allowed.get(urlKey(normaliseUrl(raw, sc.docsHosts) ?? '')) ?? null
    const v = res.value
    let returned = 0
    let dropped = 0
    const keepItems = (items) => items.filter((it) => {
      returned++
      const url = inBundle(it.source_url)
      if (!url) { dropped++; return false }
      it.source_url = url
      return true
    })
    const payload = {
      can: keepItems(v.can),
      cannot: keepItems(v.cannot),
      integrations: keepItems(v.integrations),
      contradictions: v.contradictions
        .map((c) => ({ ...c, source_urls: c.source_urls.map(inBundle).filter(Boolean) }))
        .filter((c) => c.source_urls.length > 0),
      pages_fetched: bundle.pagesFetched,
      chars: bundle.chars,
      sources: bundle.sources,
      date: today,
      // When the last full research finished (Phase 9: the reuse check reads it here instead of every run_log).
      research_at: current.map((r) => r.payload?.research_at).filter(Boolean).sort().at(-1) ?? null
    }
    await runLog(res.meta, { returned, kept: returned - dropped, dropped })
    for (const old of current) await store.updateRecord(old.id, undefined, { status: 'old' })
    const rec = await store.createRecord({ type: 'm91_facts', briefId: null, payload, status: 'current', date: today })
    return { id: rec.id, payload, reused: false }
  }

  /**
   * Reuse question research when the last successful (non-dry) research is recent and enough clusters are open.
   * The time is on today's m91_facts record (research_at), which the run has already read: no extra request.
   */
  async function shouldReuse(factsResult) {
    const t = Date.parse(factsResult?.payload?.research_at)
    const last = t > 0 ? t : null
    const recent = last !== null && now() - last < sc.reuseHours * 3600000
    if (!recent) return { reuse: false }
    const open = (await store.getRecords({ type: 'question_cluster', status: 'open' })).length
    return { reuse: open >= sc.minOpenClusters, open }
  }

  async function alreadyCoveredList() {
    const lines = []
    for (const r of await store.getRecords({ type: 'brief' })) lines.push({ date: r.date, text: `${r.payload?.title ?? r.payload?.topic ?? 'untitled'} — ${r.payload?.angle ?? r.payload?.summary ?? ''}` })
    for (const r of await store.getRecords({ type: 'draft' })) lines.push({ date: r.date, text: `${r.payload?.title ?? 'untitled'} — ${typeof r.payload?.context === 'string' ? r.payload.context : r.payload?.context?.summary ?? ''}` })
    for (const r of await store.getRecords({ type: 'question_cluster' })) {
      if (r.status === 'open' || r.status === 'used') lines.push({ date: r.date, text: `${r.payload?.main_question ?? ''} — cluster (${r.status})` })
    }
    const list = lines
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 60)
      .map((l) => `- ${l.text.replace(/\s+/g, ' ').slice(0, 200)}`)
    return list.length ? list.join('\n') : '(none yet)'
  }

  async function postSummary(result, styleSources) {
    const top = result.top_clusters
      .map((c, i) => `${i + 1}. ${c.main_question} (group ${c.topic_group}, fit ${c.m91_fit}/5, demand ${c.demand})`)
      .join('\n')
    const text = [
      `🔎 Scout finished (run ${result.run_id}, ${result.reused ? 'reused research' : 'fresh research'})`,
      `Questions: ${result.counts.questions} → clusters: ${result.counts.clusters_new} new, ${result.counts.clusters_merged} merged · Stories: ${result.counts.stories} (${result.rapid_response_story_ids.length} within ${sc.rapidResponseDays} days) · Tutorials: ${result.counts.tutorials}`,
      'Top topics:',
      top || '(none)',
      `Style notes from: ${styleSources.map((s) => s.title).join(', ') || '(none)'}`,
      `Dropped dead links: ${result.counts.dropped_dead_links} · Warnings: ${result.warnings.length}`
    ].join('\n')
    try {
      await deps.notifier?.slack(text)
    } catch (error) {
      warnings.push(`Slack summary not sent: ${error.message}`)
    }
  }

  // ======================= sources mode =======================

  async function sourcesMode() {
    const claims = (params.claims ?? []).map(String).filter(Boolean)
    if (!claims.length) throw new ScoutError('sources mode needs at least one claim')
    if (!params.briefId) throw new ScoutError('sources mode needs brief_id')
    const claimText = claims.map((c, i) => `${i + 1}. ${c}`).join('\n') + (params.reviewerNote ? `\nReviewer note: ${params.reviewerNote}` : '')
    let res
    try {
      res = await callAi('sources', { task: SOURCES, sections: { claims: claimText }, schema: SCHEMAS.scout_sources, delivery: sc.researchDelivery })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      await runLog(error.meta ?? { call: 'sources', model: sc.model, delivery: sc.researchDelivery, ms: 0, retries: 0 }, { error: error.message })
      throw new ScoutError(`sources call failed: ${error.message}`)
    }
    let returned = 0
    let kept = 0
    const out = []
    for (const c of res.value.claims) {
      const results = []
      for (const r of c.results.slice(0, 2)) {
        returned++
        const live = await liveUrl(r.url)
        if (!live) continue
        protectFields(r, [], ['note'])
        results.push({ ...r, url: live.url, url_status: live.status })
        kept++
      }
      out.push({ claim: c.claim, results })
    }
    // Claims the AI left out still count, as unverified.
    for (const claim of claims) if (!out.some((o) => o.claim === claim)) out.push({ claim, results: [] })

    const verdictOf = (c) => (c.results.some((r) => r.verdict === 'supports') ? 'supported' : c.results.some((r) => r.verdict === 'contradicts') ? 'contradicted' : 'unverified')
    const payload = { brief_id: params.briefId, version: params.version ?? null, claims: out.map((c) => ({ ...c, verdict: verdictOf(c) })) }
    const rec = await store.createRecord({ type: 'source_pack', briefId: params.briefId, payload, status: 'current', version: params.version ?? null, date: today })
    await runLog(res.meta, { returned, kept, dropped: returned - kept })
    return {
      mode: 'sources',
      record_id: rec.id,
      claims_supported: payload.claims.filter((c) => c.verdict === 'supported').length,
      claims_unverified: payload.claims.filter((c) => c.verdict === 'unverified').length,
      claims_contradicted: payload.claims.filter((c) => c.verdict === 'contradicted').length,
      claims: payload.claims,
      calls_used: callsUsed,
      warnings,
      calls
    }
  }
}

/** Compact facts text for prompts: one line per fact, with its source URL. */
export function summariseFacts(facts, { only } = {}) {
  if (!facts) return '(none)'
  const sections = only ?? ['can', 'cannot', 'integrations']
  return sections
    .map((k) => {
      const items = (facts[k] ?? []).map((f) => `  - ${f.fact ?? `${f.name}: ${f.what_it_enables}`} (${f.source_url})`)
      return `${k}:\n${items.join('\n') || '  (none)'}`
    })
    .join('\n')
}

export { SCOUT_BASE }
