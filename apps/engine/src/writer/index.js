// The Writer (Phase 4): new and revise modes, automatic fixes, content checks, repairs, fallback.

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso } from '../util/time.js'
import { randomCode } from '../util/ids.js'
import { createViaSocketClient, TruncatedError } from '../viasocket.js'
import { emit, throwIfCancelled, CancelledError } from '../events.js'
import { createUrlChecker } from '../scout/checks.js'
import { runContentChecks, hardProblems, majorProblems, urlKey, parseMarkdown, ctaVariantKey } from '../checks/content.js'
import { latestLessons } from '../lessons.js'
import { DEFAULT_CTA_TEXT } from '../strategist/prompts.js'
import { writer_draft, draftSchemaErrors } from './schemas.js'
import { buildWriterPrompt, repairTail, truncatedProblem } from './prompts.js'
import { loadBrief, allowedUrlSet, supportedSources, toneSection, tutorialSourceText, citedDocsSourceText, excerptFor, briefRules, fullBriefForWriter, buildWriterMessage } from './inputs.js'
import { extractSnippets, snippetSection, replaceSnippetTokens, tokeniseSnippets, SNIPPET_LIST_MAX_LINES } from './snippets.js'
import { needsStartHere, starterPost, withStartHere } from '../timely/starthere.js'
import { stripDocsLinks, isDocsFix } from '../util/m91links.js'
import { linkNewsSource } from './newslink.js'
import { splitLongParagraphs } from './paragraphs.js'
import { draftsOf, nextDraftVersion, saveDraft, draftVersion, isEarlierDraft } from './save.js'
import { saveRunLog } from '../util/runlog.js'

export class WriterError extends Error {
  constructor(message, { kind } = {}) {
    super(message)
    this.name = 'WriterError'
    if (kind) this.kind = kind
  }
}

const FATAL_KINDS = ['config', 'token', 'billing']

/** Thread id: writer-<brief_id>-v<version>-<new|revise|repair>-<4 random>. */
export const writerThreadId = (briefId, version, call) => `writer-${briefId}-v${version}-${call}-${randomCode(4).toLowerCase()}`

// Known acronyms, written the one right way. Plurals ("APIs", "LLMs") keep a lowercase "s"; HTTP, JSON, SMS
// and IoT take none (so "https" stays "https").
const ACRONYMS = { ai: 'AI', api: 'API', mcp: 'MCP', sdk: 'SDK', llm: 'LLM', sre: 'SRE', crm: 'CRM', json: 'JSON', url: 'URL', http: 'HTTP', sms: 'SMS', otp: 'OTP', m91: 'M91', iot: 'IoT' }
const NO_PLURAL = new Set(['http', 'json', 'sms', 'iot', 'm91', 'ai'])
const ACRONYM_RE = new RegExp(String.raw`\b(${Object.keys(ACRONYMS).join('|')})(s?)\b`, 'gi')
/** Words that are links, domains, file names, paths or emails stay as they are ("llms.txt", "m91-api.msg91.com"). */
const LITERAL_WORD = /:\/\/|@|\/|\w\.\w/

/** Acronyms in capitals, whole words only ("maintain" and "ail" are never touched). Returns the fixed text. */
export function fixAcronyms(text) {
  if (typeof text !== 'string') return text
  return text.split(/(\s+)/).map((word) => (LITERAL_WORD.test(word) ? word : word.replace(ACRONYM_RE, (all, base, s) => {
    const key = base.toLowerCase()
    if (s && NO_PLURAL.has(key)) return all
    return `${ACRONYMS[key]}${s ? 's' : ''}`
  }))).join('')
}

/** Automatic fixes (brief 10.1) on the draft. Never changes wording. Returns the fix notes. */
export function autoFixDraft(draft, { config, brief }) {
  const fixes = []
  let md = String(draft.post_markdown ?? '')
  // Acronyms in capitals in the title, title_tag and meta_description; an H1 equal to the old title follows the
  // title, so the H1 check still passes.
  const oldTitle = draft.title
  for (const [label, get, set] of [
    ['title', () => draft.title, (v) => { draft.title = v }],
    ['seo.title_tag', () => draft.seo?.title_tag, (v) => { draft.seo.title_tag = v }],
    ['seo.meta_description', () => draft.seo?.meta_description, (v) => { draft.seo.meta_description = v }]
  ]) {
    const before = get()
    const after = fixAcronyms(before)
    if (typeof before === 'string' && after !== before) {
      set(after)
      fixes.push(`wrote acronyms in capitals in ${label}`)
    }
  }
  if (typeof oldTitle === 'string' && draft.title !== oldTitle) {
    const lines = md.split('\n')
    const i = lines.findIndex((l) => /^#[ \t]+/.test(l) && l.replace(/^#[ \t]+/, '').trim() === oldTitle.trim())
    if (i >= 0) {
      lines[i] = `# ${draft.title.trim()}`
      md = lines.join('\n')
    }
  }
  // http → https for the M91 docs hosts, in links and text
  for (const host of config.scout.docsHosts) {
    const re = new RegExp(`http://${host.replace(/\./g, '\\.')}`, 'gi')
    if (re.test(md)) {
      md = md.replace(re, `https://${host}`)
      fixes.push(`rewrote http://${host} links to https`)
    }
  }
  // A story or news post links its outside source where it first names it (the Reviewer fails an unlinked news claim).
  const news = linkNewsSource(md, brief)
  md = news.markdown
  fixes.push(...news.fixes)
  // A paragraph over PARAGRAPH_MAX_SENTENCES is split at sentence ends (same words), so it never needs the Writer.
  const paras = splitLongParagraphs(md, config.content.paragraphMaxSentences ?? 3)
  md = paras.markdown
  fixes.push(...paras.fixes)
  if (!/^#\s+\S/m.test(md) && draft.title) {
    md = `# ${draft.title}\n\n${md}`
    fixes.push('added the missing H1 title')
  }
  const ctaUrl = config.m91.ctaUrl
  // A link to the CTA page that differs only in http/https, host case or a trailing slash becomes exactly M91_CTA_URL.
  const ctaKey = ctaVariantKey(ctaUrl)
  if (ctaKey) {
    let n = 0
    md = md.replace(/\]\((\S+?)\)/g, (all, u) => {
      if (u === ctaUrl || ctaVariantKey(u) !== ctaKey) return all
      n++
      return `](${ctaUrl})`
    })
    if (n) fixes.push(`rewrote ${n} CTA link(s) to exactly M91_CTA_URL`)
  }
  // After the CTA fix (a near-miss CTA is the CTA, not a docs page).
  // No M91 docs links in posts: each becomes a link to M91's main site; docs Source lines and Sources items go.
  const docs = stripDocsLinks(md, config)
  md = docs.markdown
  fixes.push(...docs.fixes)
  if (ctaUrl && !/^##\s+what to do next/im.test(md)) {
    md = `${md.trimEnd()}\n\n## What to do next\n\n[${brief.cta?.text || DEFAULT_CTA_TEXT}](${ctaUrl})\n`
    fixes.push('appended the missing "What to do next" CTA section')
  }
  const tidy = md.replace(/[ \t]+$/gm, '').replace(/\n{4,}/g, '\n\n\n')
  if (tidy !== md) {
    md = tidy
    fixes.push('collapsed extra blank lines and trailing spaces')
  }
  draft.post_markdown = md
  return fixes
}

/** Reviewer feedback items for the Writer: strings become { area: "general", problem }. */
export function writerFeedback(items = []) {
  return items
    .map((f) => (typeof f === 'string' ? { area: 'general', quote: '', problem: f, fix: '', severity: 'must' } : f))
    .filter((f) => !f.send_to || f.send_to === 'writer')
}

/**
 * @param {{ mode: 'new'|'revise', runId?, briefId, briefVersion?, version?, feedback?, sourcePack? }} params
 * @param {{ config?, store, notifier?, aiSend?, fallbackAiSend?, fetch?, urlChecker?, now? }} deps
 */
export async function runWriter(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const wc = config.writer
  const mode = params.mode ?? 'new'
  if (mode !== 'new' && mode !== 'revise') throw new WriterError(`unknown Writer mode "${mode}"`)
  if (!params.briefId) throw new WriterError('runWriter needs a brief_id')
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const fallbackAiSend = deps.fallbackAiSend ?? (wc.fallbackService && wc.fallbackModel
    ? createViaSocketClient({ config: { ...config, writer: { ...wc, service: wc.fallbackService, model: wc.fallbackModel } } }).aiSend
    : null)
  const urlChecker = deps.urlChecker ?? createUrlChecker({ fetch: deps.fetch ?? globalThis.fetch, timeoutMs: config.scout.urlCheckTimeoutMs })
  const runId = params.runId ?? params.briefId
  const warnings = []
  const autoFixes = []
  const calls = []

  // ---------- inputs ----------
  // DRY_RUN saves nothing, so the orchestrator hands the in-memory brief (and previous draft) over.
  const briefRecord = (await loadBrief(store, params.briefId, params.briefVersion)) ??
    (config.runtime.dryRun && params.brief ? { id: null, status: 'new', version: params.brief.brief_version ?? 1, payload: params.brief } : null)
  if (!briefRecord) throw new WriterError(`no brief ${params.briefId}${params.briefVersion ? ` v${params.briefVersion}` : ''}`)
  const brief = briefRecord.payload
  const briefVersion = brief.brief_version ?? briefRecord.version ?? 1
  const inMemoryPrev = config.runtime.dryRun && params.previousDraft ? params.previousDraft : null
  // Drafts are numbered per brief version: a new brief version starts again at v1.
  const sameBriefVersion = (d) => Number(d.brief_version ?? 1) === Number(briefVersion)
  const version = params.version ?? (inMemoryPrev
    ? (sameBriefVersion(inMemoryPrev) ? (Number(inMemoryPrev.version) || 0) + 1 : 1)
    : await nextDraftVersion(store, params.briefId, briefVersion))
  const feedback = writerFeedback(params.feedback)
  if (mode === 'revise' && !feedback.length && !params.sourcePack) throw new WriterError('revise mode needs Reviewer feedback for the Writer (or a source pack)')

  const isTutorial = brief.post_type === 'tutorial' || brief.tutorial?.use === true
  const tutorialText = isTutorial ? await tutorialSourceText(brief, { config, fetch: deps.fetch }) : ''
  // The only code a post may show: blocks extracted from the tutorial source or the cited docs pages.
  const snippetSource = isTutorial ? tutorialText : await citedDocsSourceText(brief, { config, fetch: deps.fetch, warnings })
  const { snippets, text: tokenisedSource } = extractSnippets(snippetSource)
  const allowed = allowedUrlSet(brief, { sourcePack: params.sourcePack, ctaUrl: config.m91.ctaUrl, snippets, config })
  const tone = await toneSection(store, brief, config)
  const lessons = await latestLessons(store, config.strategist.lessonsLimit)
  const drafts = await draftsOf(store, params.briefId)
  // The newest draft written before this one (an older brief version counts as earlier).
  const current = { version, metadata: { brief_version: briefVersion } }
  const previous = drafts.find((d) => draftVersion(d) !== null && isEarlierDraft(d, current)) ??
    (inMemoryPrev ? { version: inMemoryPrev.version, metadata: { brief_version: inMemoryPrev.brief_version ?? 1 }, payload: inMemoryPrev } : null)

  const sections = {
    tone: tone.text,
    lessons: lessons.length ? lessons.map((l) => `- ${l}`).join('\n') : null,
    allowedUrls: allowed.list.map((u) => `- ${u}`).join('\n'),
    internalLinks: brief.internal_links?.length ? JSON.stringify(brief.internal_links.map(({ url, anchor_text }) => ({ url, anchor_text }))) : null,
    interactiveIdeas: brief.interactive_ideas?.length ? JSON.stringify(brief.interactive_ideas) : null,
    tutorialText: isTutorial ? tokenisedSource : null,
    snippets: snippets.length ? snippetSection(snippets) : null,
    snippetsCompact: snippets.length ? snippetSection(snippets, { maxLines: SNIPPET_LIST_MAX_LINES }) : null
  }
  let previousContext = false
  if (mode === 'new') {
    sections.brief = JSON.stringify(fullBriefForWriter(brief))
    // A new brief version for the same lead (after a re-brief): keep what worked.
    const prevBrief = previous && previous.payload?.brief_version !== briefVersion ? await loadBrief(store, params.briefId, previous.payload?.brief_version) : null
    if (previous?.payload?.context && prevBrief && prevBrief.payload?.lead?.id === brief.lead?.id) {
      sections.previousContext = JSON.stringify(previous.payload.context)
      previousContext = true
    }
  } else {
    sections.briefRules = JSON.stringify(briefRules(brief))
    if (!previous) throw new WriterError(`revise mode: no earlier draft of brief ${params.briefId} to revise`)
    const prevCtx = JSON.stringify(previous.payload?.context ?? {})
    sections.previousDraft = wc.revisionInput === 'full' && previous.payload?.post_markdown ? tokeniseSnippets(previous.payload.post_markdown, snippets, previous.payload.snippet_inserts ?? []) : prevCtx
    sections.previousContextFallback = prevCtx
    // One FEEDBACK section: each item says where it came from (reviewer or human, Phase 5.5 B5).
    sections.feedback = JSON.stringify(feedback.map(({ source, area, quote, problem, fix, severity }) => ({ source: source ?? 'reviewer', area, quote, problem, fix, severity })))
    const excerpts = feedback.filter((f) => f.quote).map((f) => `- "${f.quote}" → ${excerptFor(previous.payload?.post_markdown, f.quote) ?? '(not found in the previous draft)'}`)
    sections.excerpts = excerpts.length ? excerpts.join('\n') : null
    const pack = supportedSources(params.sourcePack)
    sections.sourcePack = pack.length ? JSON.stringify(pack) : null
  }

  const prompt = buildWriterPrompt(config, brief, mode, { previousContext, lessons: lessons.length > 0 })

  // ---------- AI calls ----------
  async function runLog(entry) {
    const record = { run_id: runId, brief_id: params.briefId, agent: 'writer', time: istIso(new Date(now())), ...entry }
    calls.push(record)
    log.info('writer call', record)
    try {
      await saveRunLog(store, { briefId: runId, payload: record, status: entry.error ? 'error' : entry.result })
    } catch (e) {
      log.error('could not write writer run_log', { error: e })
    }
  }

  /** One logical call: retries within AI_MAX_RETRIES for unusable answers, then the fallback model. */
  async function callModel(callName, tail) {
    const { message, tutorialText: sentTutorial, trimmed } = buildWriterMessage(sections, tail)
    if (trimmed.length) warnings.push(`message trimmed to fit 50,000 characters: ${trimmed.join(', ')}`)
    // With a fallback: 2 tries on the main model, then 1 on the fallback (brief 4). Without: 1 + AI_MAX_RETRIES tries.
    const mainTries = fallbackAiSend ? 2 : Math.max(1, (config.viasocket.maxRetries ?? 3) + 1)
    const attempts = [...Array(mainTries).fill(aiSend), ...(fallbackAiSend ? [fallbackAiSend] : [])]
    let lastError = null
    let timeoutRetried = false
    for (let i = 0; i < attempts.length; i++) {
      throwIfCancelled()
      const send = attempts[i]
      const isFallback = send === fallbackAiSend && i === attempts.length - 1
      const started = now()
      try {
        const r = await send({ agent: 'writer', call: callName, prompt, message, jsonSchema: writer_draft, threadId: writerThreadId(params.briefId, version, callName), retries: config.viasocket.maxRetries })
        const fixes = [...(r.parseFixes ?? [])]
        const errors = draftSchemaErrors(r.content)
        await runLog({ call: callName, model: r.model ?? (isFallback ? wc.fallbackModel : wc.model), delivery: r.delivery ?? wc.delivery, ms: r.ms ?? now() - started, result: errors.length ? 'schema_invalid' : 'ok', hard_failures: errors, auto_fixes: fixes, error: null, fallback: isFallback })
        if (!errors.length) return { draft: r.content, model: r.model ?? (isFallback ? wc.fallbackModel : wc.model), fixes, tutorialSent: sentTutorial, truncated: false }
        lastError = new WriterError(`answer did not match writer_draft: ${errors.slice(0, 3).join('; ')}`, { kind: 'schema' })
      } catch (error) {
        if (error instanceof CancelledError) throw error
        await runLog({ call: callName, model: isFallback ? wc.fallbackModel : wc.model, delivery: wc.delivery, ms: now() - started, result: 'error', hard_failures: [], auto_fixes: [], error: error.message, fallback: isFallback })
        if (FATAL_KINDS.includes(error?.kind)) throw new WriterError(`${callName} call failed (${error.kind}): ${error.message}`, { kind: error.kind })
        if (error instanceof TruncatedError) return { truncated: true, partial: error.result?.content ?? null, tutorialSent: sentTutorial }
        if (error?.kind === 'timeout') {
          // rtlayer timeout: one retry on a fresh thread, then the fallback, then fail.
          if (timeoutRetried) {
            if (fallbackAiSend && !isFallback) {
              i = attempts.length - 2
              lastError = error
              continue
            }
            throw new WriterError(`${callName}: no answer within AI_RTLAYER_TIMEOUT_MS (retried once)`, { kind: 'timeout' })
          }
          timeoutRetried = true
        }
        lastError = error
      }
    }
    throw new WriterError(`${callName}: no usable draft after ${attempts.length} attempt(s)${fallbackAiSend ? ' including the fallback model' : ''}: ${lastError?.message ?? 'unknown error'}`, { kind: lastError?.kind ?? 'schema' })
  }

  async function check(draft, replaced) {
    throwIfCancelled()
    emit('step.started', { agent: 'writer', step: 'checks' })
    const fixes = autoFixDraft(draft, { config, brief })
    autoFixes.push(...fixes)
    for (const f of fixes) if (isDocsFix(f) && !warnings.includes(f)) warnings.push(f)
    const linkUrls = [...new Set(parseMarkdown(draft.post_markdown).links.map((l) => l.url))]
    const linkStatuses = new Map()
    await Promise.all(linkUrls.map(async (u) => linkStatuses.set(urlKey(u), await urlChecker.check(u))))
    const res = runContentChecks({ draft, brief, config, allowedUrls: allowed.set, snippets, snippetErrors: replaced.errors, snippetRangeErrors: replaced.rangeErrors, inserts: replaced.inserts, linkStatuses })
    const hardFails = res.results.filter((x) => x.severity === 'hard' && !x.passed).length
    const softFails = res.results.filter((x) => x.severity === 'soft' && !x.passed).length
    emit('step.finished', { agent: 'writer', step: 'checks', data: { hard_failures: hardFails, soft_warnings: softFails } })
    emit('step.output', { agent: 'writer', step: 'checks', message: `${softFails} soft warning(s), ${hardFails} hard failure(s)`, data: { hard_failures: hardFails, soft_warnings: softFails, failed: res.results.filter((x) => !x.passed).map((x) => x.id) } })
    return res
  }

  // The timely lane: a rapid-response post starts with a line pointing new readers to the Starter post.
  const starter = needsStartHere(brief, config) ? await starterPost(store) : null
  if (needsStartHere(brief, config) && !starter) warnings.push('timely post: no approved Starter post yet, so no Start-here line (the check start_here_line fails)')
  const maxWords = Math.floor(0.8 * (brief.word_target?.max ?? config.content.targetWordsMax))
  let answer = await callModel(mode)
  let repairs = 0
  let draft = null
  let checks = null
  let snippetsUsed = []
  let snippetInserts = []
  for (;;) {
    if (answer.truncated) {
      if (repairs >= wc.maxRepairs) throw new WriterError(`the ${mode} answer was cut off (finish_reason "truncated") and no repairs are left`, { kind: 'truncated' })
      repairs++
      answer = await callModel('repair', repairTail(answer.partial ?? '(cut off)', [truncatedProblem(maxWords)]))
      continue
    }
    autoFixes.push(...answer.fixes)
    draft = answer.draft
    const replaced = replaceSnippetTokens(draft.post_markdown, snippets)
    autoFixes.push(...replaced.widened)
    draft.post_markdown = replaced.markdown
    // The timely lane: the Start-here line is put in by code (exact), before the checks.
    if (starter) draft.post_markdown = withStartHere(draft.post_markdown, starter)
    snippetsUsed = replaced.used
    snippetInserts = replaced.inserts
    checks = await check(draft, replaced)
    // Only a major hard check calls the Writer again; a minor one (a long paragraph or sentence) is listed for you.
    if (checks.major_passed || repairs >= wc.maxRepairs) break
    repairs++
    // The repair sees snippet tokens again, so it places them instead of copying code.
    answer = await callModel('repair', repairTail({ ...draft, post_markdown: tokeniseSnippets(draft.post_markdown, snippets, snippetInserts) }, majorProblems(checks.results)))
  }

  // ---------- save ----------
  throwIfCancelled()
  const payload = {
    title: draft.title, post_markdown: draft.post_markdown, tldr: draft.tldr, seo: draft.seo, context: draft.context, revision_notes: draft.revision_notes,
    checks: { hard_passed: checks.hard_passed, major_passed: checks.major_passed, results: checks.results },
    word_count: checks.word_count, reading: checks.reading, model_used: answer.model, writer_mode: mode, repairs_used: repairs, auto_fixes: autoFixes,
    snippets_used: snippetsUsed, snippets_available: snippets.length,
    // The inserted snippets themselves, for the Reviewer (B3) and later re-checks.
    snippets: snippets.filter((s) => snippetsUsed.includes(s.id)),
    // Each inserted token (whole snippet or line range), so revisions and re-checks can rebuild it.
    snippet_inserts: snippetInserts
  }
  const { record, status, warnings: saveWarnings } = await saveDraft(store, { briefId: params.briefId, briefRecord, version, briefVersion, topicGroup: brief.topic_group, payload, hardPassed: checks.hard_passed })
  warnings.push(...saveWarnings)
  if (!checks.hard_passed) warnings.push(`saved as drafted_with_issues: ${hardProblems(checks.results).join(' | ')}`)
  if (config.runtime.dryRun) log.info('DRY_RUN: draft not saved', { title: draft.title, version, word_count: checks.word_count, reading: checks.reading, hard_passed: checks.hard_passed, failed: checks.results.filter((x) => !x.passed).map((x) => x.id) })

  const result = {
    mode, brief_id: params.briefId, brief_version: briefVersion, version, record_id: record.id, status, title: draft.title,
    word_count: checks.word_count, reading: checks.reading, hard_passed: checks.hard_passed, repairs_used: repairs,
    model_used: answer.model, auto_fixes: autoFixes, warnings
  }
  await postSlack(deps.notifier, config, result, draft.post_markdown, warnings)
  return { ...result, draft: payload, calls }
}

async function postSlack(notifier, config, r, markdown, warnings) {
  if (!notifier) return
  const line = `✍️ Draft v${r.version} ready: *${r.title}* · ${r.word_count} words · grade ${r.reading.post_grade} · hard checks ${r.hard_passed ? 'passed' : 'failed'} · repairs ${r.repairs_used} → Reviewer`
  try {
    await notifier.slack(config.writer.postDrafts ? `${line}\n\n${markdown}` : line)
  } catch (error) {
    warnings.push(`Slack draft message not sent: ${error.message}`)
  }
}
