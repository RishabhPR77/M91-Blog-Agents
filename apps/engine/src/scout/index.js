// The Scout (Phase 2): research mode and sources mode. See docs/ and the Phase 2 brief.

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istDate, istIso } from '../util/time.js'
import { newBriefId, newRecordId, newScoutThreadId } from '../util/ids.js'
import { createViaSocketClient, AiError, TruncatedError } from '../viasocket.js'
import { SCOUT_BASE, FACTS, QUESTIONS, STORIES, TUTORIALS, CLUSTERS, STYLE, SOURCES, SCHEMA_RETRY_NOTE, TOPIC_GROUPS, MESSAGE_MAX, buildPrompt, fitMessage } from './prompts.js'
import { SCHEMAS, scout_m91_facts_inline } from './schemas.js'
import { limiter, validateAgainst, createUrlChecker, normaliseUrl, isKeptStatus, protectFields, removeLongQuotes, storyDateRule, freshnessFromDates } from './checks.js'
import { buildDocsBundle, fetchSkillReadme, DocsError } from './docs.js'
import { classifyCluster, mergeClusterPayload, storedStoryUrls, isDuplicateTutorial } from './dedupe.js'
import { rankClusters } from './rank.js'
import { emit, scoutStepName, throwIfCancelled, CancelledError } from '../events.js'
import { saveRunLog } from '../util/runlog.js'
import { dedupeSettings } from '../dedupe.js'

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
  if (params.mode !== 'research') throw new ScoutError(`unknown Scout mode "${params.mode}"`)
  return researchMode()

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
