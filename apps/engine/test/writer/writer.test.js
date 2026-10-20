import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runWriter, autoFixDraft, WriterError, writerFeedback, fixAcronyms } from '../../src/writer/index.js'
import { allowedUrlSet, excerptFor, tutorialSourceText, buildWriterMessage, briefRules } from '../../src/writer/inputs.js'
import { extractSnippets, snippetSection } from '../../src/writer/snippets.js'
import { WRITER_BASE } from '../../src/writer/prompts.js'
import { parseJsonContent, AiError, TruncatedError } from '../../src/viasocket.js'
import { withRun, replay, resetEvents, CancelledError } from '../../src/events.js'
import { createNotifier } from '../../src/notify.js'
import { urlKey } from '../../src/checks/content.js'
import { setSink } from '../../src/util/log.js'
import { fakeNotifier, fakeFetch, memoryStore } from '../helpers.js'
import { NOW, CTA, ISSUE, LLMS, REPO, SCRIPT, BRIEF_ID, GOOD_MD, config, brief, seededStore, draftAnswer, fakeAi, okChecker } from './fixtures.js'

beforeEach(() => resetEvents())
const now = () => NOW
const quiet = () => setSink(() => {})
const drafts = (store) => [...store.records.values()].filter((r) => r.type === 'draft').sort((a, b) => a.version - b.version)

async function setup({ env = {}, answers, briefOver, store, notifier, fetch, fallback } = {}) {
  const cfg = config(env)
  store ??= await seededStore(briefOver)
  if (cfg.runtime.dryRun) store.setDryRun(true)
  const ai = fakeAi(answers)
  notifier ??= fakeNotifier()
  const deps = { config: cfg, store, notifier, aiSend: ai, fallbackAiSend: fallback ?? null, urlChecker: okChecker(), fetch, now }
  return { cfg, store, ai, notifier, deps, run: (params = {}) => runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1', ...params }, deps) }
}

test('new mode: one call, prompt and message, draft v1 saved with checks, brief marked drafted, Slack line', async () => {
  const restore = quiet()
  const s = await setup()
  const r = await s.run()
  restore()
  assert.equal(s.ai.requests.length, 1)
  const q = s.ai.requests[0]
  assert.equal(q.agent, 'writer')
  assert.equal(q.call, 'new')
  assert.match(q.threadId, /^writer-261018-1400-ABCD-v1-new-[a-z0-9]{4}$/)
  assert.ok(q.prompt.startsWith(WRITER_BASE.slice(0, 40)))
  assert.match(q.prompt, /You have no web access\./)
  assert.match(q.prompt, /between 180 and 500 words/)
  assert.match(q.prompt, /Main keyword "agent approval"/)
  assert.match(q.prompt, /\[Try M91: send your first alert in a few minutes\.\]\(https:\/\/m91\.msg91\.com\/signup\)/)
  assert.match(q.prompt, /"delve", "leverage"/)
  assert.match(q.prompt, /Task: write the first draft/)
  assert.ok(!/PREVIOUS CONTEXT describes/.test(q.prompt))
  assert.equal(q.jsonSchema.name, 'writer_draft')
  assert.match(q.message, /^--- BRIEF ---\n\{/)
  assert.match(q.message, /--- TONE ---\nprofile: friendly-teacher\nnotes: Explains like a patient teacher/)
  assert.match(q.message, /--- ALLOWED URLS ---\n- https:\/\/github\.com\/example\/agents\/issues\/1/)
  assert.match(q.message, /--- INTERACTIVE IDEAS ---\n\[\{"block_type":"phone_ring_sim"/)
  assert.ok(!/review_flags/.test(q.message), 'review_flags not sent')

  assert.equal(r.version, 1)
  assert.equal(r.hard_passed, true)
  assert.equal(r.repairs_used, 0)
  assert.equal(r.status, 'drafted')
  assert.equal(r.model_used, 'gemini-2.5-flash')
  assert.ok(r.word_count > 180)
  assert.ok(typeof r.reading.post_grade === 'number')
  const [d] = drafts(s.store)
  assert.equal(d.status, 'drafted')
  assert.equal(d.briefId, BRIEF_ID)
  assert.equal(d.payload.brief_version, 1)
  assert.equal(d.payload.checks.hard_passed, true)
  assert.ok(d.payload.checks.results.length > 25)
  assert.equal(d.payload.writer_mode, 'new')
  const b = [...s.store.records.values()].find((x) => x.type === 'brief')
  assert.equal(b.status, 'drafted')
  assert.match(s.notifier.sent.slack[0], /^✍️ Draft v1 ready: \*How agent approval works with a phone call\* · \d+ words · grade [\d.]+ · hard checks passed · repairs 0 → Reviewer$/)
  const logs = [...s.store.records.values()].filter((x) => x.type === 'run_log').map((x) => x.payload)
  assert.equal(logs[0].agent, 'writer')
  assert.equal(logs[0].call, 'new')
})

test('SLACK_POST_DRAFTS=true posts the line and the full post (chunked by notify)', async () => {
  const restore = quiet()
  const s = await setup({ env: { SLACK_POST_DRAFTS: 'true' } })
  await s.run()
  restore()
  assert.match(s.notifier.sent.slack[0], /^✍️ Draft v1 ready[\s\S]+# How agent approval works/)
})

test('automatic fixes: fenced JSON string, missing H1, missing CTA, http→https, blank lines', () => {
  const fixes = []
  const v = parseJsonContent('```json\n{"a":1}\n```', fixes)
  assert.deepEqual(v, { a: 1 })
  assert.deepEqual(fixes, ['stripped code fences around the JSON answer'])
  const fixes2 = []
  assert.deepEqual(parseJsonContent('Here it is: {"a":{"b":"}"}} thanks', fixes2), { a: { b: '}' } })
  assert.deepEqual(fixes2, ['extracted the JSON object from text around it'])
  assert.throws(() => parseJsonContent('no json here'), (e) => e instanceof AiError && e.kind === 'parse')

  const cfg = config()
  const d = { title: 'T', post_markdown: 'Intro line.   \n\n\n\n\nSee http://m91.msg91.com/llms.txt now.' }
  const notes = autoFixDraft(d, { config: cfg, brief: brief() })
  assert.match(d.post_markdown, /^# T\n\nIntro line\.\n/)
  assert.match(d.post_markdown, /https:\/\/m91\.msg91\.com\/llms\.txt/)
  assert.match(d.post_markdown, /## What to do next\n\n\[Try M91: send your first alert in a few minutes\.\]\(https:\/\/m91\.msg91\.com\/signup\)\n$/)
  assert.ok(!/\n{4,}/.test(d.post_markdown))
  assert.equal(notes.length, 4)
})

test('CTA auto-fix: a near-miss CTA URL (slash, host case, http) becomes exactly M91_CTA_URL; another URL is left alone', () => {
  for (const near of ['https://m91.msg91.com/signup/', 'https://M91.MSG91.com/signup', 'http://m91.msg91.com/signup']) {
    const d = { title: 'T', post_markdown: `# T\n\nIntro.\n\n## What to do next\n\n[Try M91](${near})\n` }
    const notes = autoFixDraft(d, { config: config(), brief: brief() })
    assert.ok(d.post_markdown.includes(`[Try M91](${CTA})`), `${near} → ${d.post_markdown}`)
    // (http on an M91 docs host is already fixed by the docs-host rewrite.)
    assert.ok(notes.some((n) => /rewrote 1 CTA link\(s\) to exactly M91_CTA_URL|rewrote http:\/\/m91\.msg91\.com links to https/.test(n)), notes.join(' | '))
  }
  const other = { title: 'T', post_markdown: '# T\n\nIntro.\n\n## What to do next\n\n[Try M91](http://M91-site.example.com/start/)\n' }
  autoFixDraft(other, { config: config({ M91_CTA_URL: 'https://m91-site.example.com/start' }), brief: brief() })
  assert.ok(other.post_markdown.includes('[Try M91](https://m91-site.example.com/start)'), other.post_markdown)
  const d = { title: 'T', post_markdown: `# T\n\nIntro.\n\n## What to do next\n\n[Try M91](https://m91.msg91.com/SIGNUP)\n` }
  autoFixDraft(d, { config: config(), brief: brief() })
  assert.ok(d.post_markdown.includes('(https://m91.msg91.com/SIGNUP)'), 'path case is not a near miss')
})

test('prompt has the simplicity re-read and link-text rules; LESSONS section and line only when lessons exist', async () => {
  const restore = quiet()
  const none = await setup()
  await none.run()
  const q0 = none.ai.requests[0]
  assert.match(q0.prompt, /Before you answer, re-read every sentence: split any sentence over 20 words;/)
  assert.match(q0.prompt, /Never use "\[Source\]", "\[here\]", "\[link\]", "\[this\]", "\[click here\]" or a bare URL as link text\./)
  assert.doesNotMatch(q0.prompt, /Apply the LESSONS/)
  assert.doesNotMatch(q0.message, /--- LESSONS ---/)
  const store = await seededStore()
  for (const [text, date] of [['Explain webhook the first time.', '2026-10-01'], ['Keep intros to two sentences.', '2026-10-15']]) await store.createRecord({ type: 'lesson', payload: text, date })
  const s = await setup({ store, env: { LESSONS_LIMIT: '1' } })
  await s.run()
  restore()
  assert.match(s.ai.requests[0].prompt, /\nApply the LESSONS from past reviews\.$/)
  assert.match(s.ai.requests[0].message, /--- LESSONS ---\n- Keep intros to two sentences\.\n--- ALLOWED URLS ---/)
})

test('repair: a hard failure gets one repair call listing the problems, then passes', async () => {
  const restore = quiet()
  const bad = draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', "We've seen that a pause keeps") })
  const s = await setup({ answers: { new: bad } })
  const r = await s.run()
  restore()
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['new', 'repair'])
  const rep = s.ai.requests[1]
  assert.notEqual(rep.threadId, s.ai.requests[0].threadId)
  assert.equal(rep.prompt, s.ai.requests[0].prompt, 'same prompt as the failed call')
  assert.match(rep.message, /--- YOUR PREVIOUS ANSWER ---\n\{/)
  assert.match(rep.message, /--- PROBLEMS FOUND BY THE CHECKER ---\n- first_person: we've seen/)
  assert.match(rep.message, /--- WHAT TO DO ---\nReturn a corrected answer/)
  assert.equal(r.repairs_used, 1)
  assert.equal(r.hard_passed, true)
})

test('still failing after the repair: saved as drafted_with_issues and passed on', async () => {
  const restore = quiet()
  const bad = draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', "We've seen that a pause keeps") })
  const s = await setup({ answers: { new: bad, repair: bad } })
  const r = await s.run()
  restore()
  assert.equal(r.hard_passed, false)
  assert.equal(r.status, 'drafted_with_issues')
  assert.equal(drafts(s.store)[0].status, 'drafted_with_issues')
  assert.ok(r.warnings.some((w) => /drafted_with_issues: first_person/.test(w)))
})

test('schema failure: retries within AI_MAX_RETRIES, then the run fails (no fallback)', async () => {
  const restore = quiet()
  const s = await setup({ answers: { new: { nope: true } } })
  await assert.rejects(s.run(), (e) => e instanceof WriterError && /no usable draft after 2 attempt/.test(e.message))
  restore()
  assert.equal(s.ai.requests.length, 2)
  assert.equal(drafts(s.store).length, 0)
})

test('schema failure with a fallback configured: 2 main tries, then the fallback model saves the draft', async () => {
  const restore = quiet()
  const fallback = fakeAi({}, { model: 'claude-sonnet-4-6' })
  const s = await setup({ answers: { new: { nope: true } }, fallback })
  const r = await s.run()
  restore()
  assert.equal(s.ai.requests.length, 2)
  assert.equal(fallback.requests.length, 1)
  assert.equal(r.model_used, 'claude-sonnet-4-6')
  assert.equal(r.hard_passed, true)
})

test('config/token/billing errors fail at once; a truncated answer counts as a repair asking for fewer words', async () => {
  const restore = quiet()
  const fatal = await setup({ answers: { new: new AiError('bad model', { kind: 'config' }) } })
  await assert.rejects(fatal.run(), /new call failed \(config\)/)
  assert.equal(fatal.ai.requests.length, 1)

  const tr = await setup({ answers: { new: new TruncatedError({ content: '{"title":' }) } })
  const r = await tr.run()
  restore()
  assert.equal(r.repairs_used, 1)
  assert.match(tr.ai.requests[1].message, /return the same post, at most 400 words/)
})

test('rtlayer timeout: one retry on a fresh thread, then fail', async () => {
  const restore = quiet()
  const s = await setup({ answers: { new: new AiError('No answer in thread history after 300 s', { kind: 'timeout' }) } })
  await assert.rejects(s.run(), /no answer within AI_RTLAYER_TIMEOUT_MS/)
  restore()
  assert.equal(s.ai.requests.length, 2)
  assert.notEqual(s.ai.requests[0].threadId, s.ai.requests[1].threadId)
})

test('revise mode (context): trimmed brief, previous context, feedback, quoted excerpts; v2 saved, v1 superseded', async () => {
  const restore = quiet()
  const s = await setup()
  await s.run()
  const feedback = [
    { area: 'clarity', quote: 'A ringing phone gets attention fast.', problem: 'vague', fix: 'be concrete', severity: 'must', send_to: 'writer' },
    { area: 'scope', quote: 'x', problem: 'not for me', fix: '', severity: 'should', send_to: 'strategist' }
  ]
  const revised = draftAnswer({ revision_notes: [{ feedback_quote: 'A ringing phone gets attention fast.', what_changed: 'made concrete' }] })
  s.ai.requests.length = 0
  const r = await runWriter({ mode: 'revise', briefId: BRIEF_ID, runId: 'R-1', feedback }, { ...s.deps, aiSend: fakeAi({ revise: revised }) })
  restore()
  assert.equal(r.version, 2)
  const v = drafts(s.store)
  assert.deepEqual(v.map((d) => [d.version, d.status]), [[1, 'superseded'], [2, 'drafted']])
  assert.equal(v[1].payload.writer_mode, 'revise')
  assert.deepEqual(v[1].payload.revision_notes, revised.revision_notes)
})

test('revise inputs: context vs full previous draft, excerpts found, strategist items filtered out', async () => {
  const restore = quiet()
  for (const input of ['context', 'full']) {
    const s = await setup({ env: { WRITER_REVISION_INPUT: input } })
    await s.run()
    const ai = fakeAi()
    await runWriter({ mode: 'revise', briefId: BRIEF_ID, runId: 'R-1', feedback: [{ area: 'clarity', quote: 'A ringing phone gets attention fast.', problem: 'p', fix: 'f', severity: 'must' }] }, { ...s.deps, aiSend: ai })
    const m = ai.requests[0].message
    assert.match(m, /^--- BRIEF RULES ---\n\{"title":"How agent approval works with a phone call"/)
    assert.ok(!/--- BRIEF ---/.test(m))
    if (input === 'context') assert.match(m, /--- PREVIOUS DRAFT ---\n\{"summary":"Explains agent approval/)
    else assert.match(m, /--- PREVIOUS DRAFT ---\n# How agent approval works/)
    assert.match(m, /--- FEEDBACK ---\n\[\{"source":"reviewer","area":"clarity","quote":"A ringing phone gets attention fast\."/)
    assert.match(m, /--- QUOTED EXCERPTS ---\n- "A ringing phone gets attention fast\." → A ringing phone gets attention fast\. A chat message can wait unread for hours\./)
    assert.match(ai.requests[0].prompt, /Task: revise the post/)
  }
  restore()
  assert.deepEqual(writerFeedback([{ send_to: 'strategist', problem: 'x' }, 'plain text']).map((f) => f.problem), ['plain text'])
  assert.match(excerptFor(GOOD_MD, 'how one   FRAMEWORK handles'), /^A pause keeps a person in charge./)
  assert.equal(excerptFor(GOOD_MD, 'not in the post'), null)
})

test('previous context only for a new brief version with the same lead', async () => {
  const restore = quiet()
  const s = await setup()
  await s.run()
  // Re-brief, same lead → v2 of the brief.
  await s.store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief({ brief_version: 2 }), status: 'new', version: 2, topicGroup: 1 })
  const same = fakeAi()
  await runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1' }, { ...s.deps, aiSend: same })
  assert.match(same.requests[0].message, /--- PREVIOUS CONTEXT ---\n\{"summary"/)
  assert.match(same.requests[0].prompt, /PREVIOUS CONTEXT describes an earlier draft/)
  // Re-brief to a different lead → v3, no previous context.
  await s.store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief({ brief_version: 3, lead: { kind: 'tutorial', id: 'T-9' } }), status: 'new', version: 3, topicGroup: 1 })
  const other = fakeAi()
  await runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1' }, { ...s.deps, aiSend: other })
  restore()
  assert.ok(!/PREVIOUS CONTEXT/.test(other.requests[0].message))
})

test('allowed URL set: new mode, revise with a source pack, tutorials; the CTA is always allowed', () => {
  const b = brief()
  const a = allowedUrlSet(b, { ctaUrl: CTA })
  assert.deepEqual([...a.set].sort(), [ISSUE, LLMS, CTA].map(urlKey).sort())
  const pack = { claims: [{ claim: 'c', results: [{ url: 'https://docs.example.com/proof', publisher: 'p', verdict: 'supports', note: 'n' }, { url: 'https://other.example.com/no', verdict: 'contradicts' }] }] }
  const r = allowedUrlSet(b, { ctaUrl: CTA, sourcePack: pack })
  assert.ok(r.set.has(urlKey('https://docs.example.com/proof')))
  assert.ok(!r.set.has(urlKey('https://other.example.com/no')))
  const t = allowedUrlSet(brief({ post_type: 'tutorial', tutorial: { use: true, steps: [{ step: 's', source_url: SCRIPT }], gaps: [] } }), { ctaUrl: CTA })
  assert.ok(t.set.has(urlKey(SCRIPT)))
  assert.deepEqual(Object.keys(briefRules(b)).sort().slice(0, 3), ['angle', 'claims_to_avoid', 'cta'])
})

const TUTORIAL_CODE = './scripts/m91.sh --title "Deploy?" --respond'
const tutorialFetch = async (url) => {
  const res = (status, text) => ({ ok: status < 400, status, text: async () => text, headers: { get: () => 'text/plain' } })
  if (url === 'https://api.github.com/repos/MSG91/m91-skill/contents/scripts/m91.sh') return res(200, `#!/bin/sh\n${TUTORIAL_CODE}\n`)
  if (url === 'https://api.github.com/repos/MSG91/m91-skill/readme') return res(200, '# m91-skill\nInstall it:\n\n```bash\nnpx skills add MSG91/m91-skill\n```\n')
  return res(404, '')
}
const tutorialBrief = { post_type: 'tutorial', format: 'tutorial', tutorial: { use: true, tutorial_id: 'T-1', target: 'CI', reader_outcome: 'x', steps: [{ step: 'Install', source_url: REPO }, { step: 'Run', source_url: SCRIPT }], gaps: ['Retry policy is not documented'] }, interactive_ideas: [{ block_type: 'steps_checklist', why: 'x' }] }
const tutorialPost = (codeLines) => GOOD_MD.replace('## How do I start?\n', `## How do I start?\n\nStart small.\n\n1. Run the script.\n\nThis line runs the alert script.\n\n${codeLines}\n\nThe docs do not cover the retry policy.\n`)

test('tutorial: source text fetched, code given as CODE SNIPPETS, [[SNIPPET:Sn]] replaced by the exact block and its source line', async () => {
  const restore = quiet()
  const text = await tutorialSourceText(brief(tutorialBrief), { config: config(), fetch: tutorialFetch })
  assert.match(text, /^=== SOURCE: https:\/\/github\.com\/MSG91\/m91-skill ===\n# m91-skill/)
  assert.match(text, /=== SOURCE: https:\/\/github\.com\/MSG91\/m91-skill\/blob\/main\/scripts\/m91\.sh ===\n#!\/bin\/sh/)
  const s = await setup({ briefOver: tutorialBrief, fetch: tutorialFetch, answers: { new: draftAnswer({ post_markdown: tutorialPost('[[SNIPPET:S2]]') }) } })
  const r = await s.run()
  restore()
  const msg = s.ai.requests[0].message
  // The source text keeps its prose, with each code block replaced by its token; the code travels in CODE SNIPPETS.
  assert.match(msg, /--- TUTORIAL SOURCE TEXT ---\n=== SOURCE: https:\/\/github\.com\/MSG91\/m91-skill ===\n# m91-skill\nInstall it:\n\n\[\[SNIPPET:S1\]\]/)
  assert.match(msg, /--- CODE SNIPPETS ---\n\[S1\] kind: block · language: bash · lines 1-1 · source: https:\/\/github\.com\/MSG91\/m91-skill\ncontext: # m91-skill Install it:\n```bash\n1\| npx skills add MSG91\/m91-skill\n```/)
  assert.match(msg, /\[S2\] kind: file · language: bash · lines 1-2 · source: https:\/\/github\.com\/MSG91\/m91-skill\/blob\/main\/scripts\/m91\.sh/)
  assert.match(s.ai.requests[0].prompt, /NEVER write code or commands yourself, not even one line\./)
  const saved = drafts(s.store)[0].payload
  assert.ok(saved.post_markdown.includes(`\`\`\`bash\n#!/bin/sh\n${TUTORIAL_CODE}\n\`\`\`\n\nSource: [github.com: scripts/m91.sh](${SCRIPT})`), saved.post_markdown)
  assert.equal(saved.checks.results.find((x) => x.id === 'ai_written_code').passed, true)
  assert.deepEqual(saved.snippets_used, ['S2'])
  assert.equal(r.hard_passed, true)
  const broken = await setup({ briefOver: tutorialBrief, fetch: async () => ({ ok: false, status: 500, text: async () => '' }) })
  await assert.rejects(broken.run(), /no tutorial without its source text/)
})

test('tutorial: AI-written code and an unknown snippet id fail hard; the repair sees tokens, not code', async () => {
  const restore = quiet()
  const s = await setup({
    briefOver: tutorialBrief,
    fetch: tutorialFetch,
    answers: {
      new: draftAnswer({ post_markdown: tutorialPost(`[[SNIPPET:S7]]\n\n\`\`\`bash\n${TUTORIAL_CODE} --timeout 30\n\`\`\``) }),
      repair: draftAnswer({ post_markdown: tutorialPost('[[SNIPPET:S2]]') })
    }
  })
  const r = await s.run()
  restore()
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['new', 'repair'])
  const repairMsg = s.ai.requests[1].message
  assert.match(repairMsg, /- snippet_unknown: unknown snippet id S7 \(CODE SNIPPETS has S1, S2\)/)
  assert.match(repairMsg, /- ai_written_code: code block\(s\) 1 are not snippets from CODE SNIPPETS/)
  assert.equal(r.hard_passed, true)
  assert.equal(r.repairs_used, 1)
})

test('not a tutorial: cited M91 docs pages give snippets; an unloadable page is a warning, not a failure', async () => {
  const restore = quiet()
  const fetch = async (url) => (url === LLMS
    ? { ok: true, status: 200, text: async () => '# M91\nSend an alert:\n\n```bash\ncurl -X POST https://m91.msg91.com/s/<send-link>\n```\n' }
    : { ok: false, status: 404, text: async () => '' })
  const s = await setup({ fetch })
  await s.run()
  assert.match(s.ai.requests[0].message, /--- CODE SNIPPETS ---\n\[S1\] kind: block · language: bash · lines 1-1 · source: https:\/\/m91\.msg91\.com\/llms\.txt/)
  assert.doesNotMatch(s.ai.requests[0].message, /--- TUTORIAL SOURCE TEXT ---/)
  const down = await setup({ fetch: async () => { throw new TypeError('fetch failed') } })
  const r = await down.run()
  restore()
  assert.doesNotMatch(down.ai.requests[0].message, /--- CODE SNIPPETS ---/)
  assert.ok(r.warnings.some((w) => /snippet source https:\/\/m91\.msg91\.com\/llms\.txt not fetched/.test(w)))
})

test('message size guard: tutorial text trimmed first to stay under 50,000 characters', () => {
  const { message, tutorialText, trimmed } = buildWriterMessage({ brief: '{}', tone: 't', allowedUrls: '- x', tutorialText: 'y'.repeat(60000) })
  assert.ok(message.length <= 50000)
  assert.ok(tutorialText.length < 60000)
  assert.deepEqual(trimmed, ['tutorial source text'])
})

test('DRY_RUN: nothing saved except run_log; no Slack request', async () => {
  const restore = quiet()
  const fetch = fakeFetch(() => ({ body: { ok: true } }))
  const cfg = config({ DRY_RUN: 'true' })
  const s = await setup({ env: { DRY_RUN: 'true' }, notifier: createNotifier({ config: cfg, fetch }) })
  const before = s.store.writes.create + s.store.writes.update
  const r = await s.run()
  restore()
  assert.match(r.record_id, /^dryrun-/)
  assert.equal(drafts(s.store).length, 0)
  assert.equal([...s.store.records.values()].find((x) => x.type === 'brief').status, 'new')
  const runLogs = [...s.store.records.values()].filter((x) => x.type === 'run_log').length
  assert.equal(s.store.writes.create + s.store.writes.update - before, runLogs)
  assert.equal(fetch.calls.length, 0)
})

test('events: checks step, one ai.call per call with its call name, summaries; no post text or secrets', async () => {
  const restore = quiet()
  const bad = draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', "We've seen that a pause keeps") })
  const s = await setup({ answers: { new: bad } })
  // Real aiSend wrapper would emit ai.call; the fake doesn't, so count run_logs and check step events here.
  await withRun('R-ev', () => s.run({ runId: 'R-ev' }))
  restore()
  const evs = replay('R-ev')
  const checks = evs.filter((e) => e.step === 'checks')
  assert.deepEqual(checks.filter((e) => e.type !== 'log').map((e) => e.type), ['step.started', 'step.finished', 'step.output', 'step.started', 'step.finished', 'step.output'])
  assert.match(checks.find((e) => e.type === 'step.output').message, /soft warning\(s\), 1 hard failure\(s\)/)
  const all = JSON.stringify(evs)
  assert.ok(!all.includes('A ringing phone gets attention fast'), 'no post text in events')
  assert.ok(!all.includes('fake-embed-secret-for-tests'))
})

test('cancel: during the AI call → CancelledError, no draft saved', async () => {
  const restore = quiet()
  const controller = new AbortController()
  const s = await setup({ answers: { new: () => { controller.abort(); return new CancelledError() } } })
  await assert.rejects(withRun('R-c', () => s.run(), { signal: controller.signal }), CancelledError)
  restore()
  assert.equal(drafts(s.store).length, 0)
})

test('revise needs feedback or a source pack, and an earlier draft', async () => {
  const s = await setup()
  await assert.rejects(runWriter({ mode: 'revise', briefId: BRIEF_ID }, s.deps), /needs Reviewer feedback/)
  await assert.rejects(runWriter({ mode: 'revise', briefId: BRIEF_ID, feedback: ['fix it'] }, s.deps), /no earlier draft/)
  await assert.rejects(runWriter({ mode: 'new', briefId: 'nope' }, s.deps), /no brief nope/)
})

test('tutorial: a line-range token inserts exactly those lines; the range is saved; a bad range gets a repair', async () => {
  const restore = quiet()
  const s = await setup({
    briefOver: tutorialBrief,
    fetch: tutorialFetch,
    answers: { new: draftAnswer({ post_markdown: tutorialPost('[[SNIPPET:S2:L2-L9]]') }), repair: draftAnswer({ post_markdown: tutorialPost('[[SNIPPET:S2:L2-L2]]') }) }
  })
  const r = await s.run()
  restore()
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['new', 'repair'])
  assert.match(s.ai.requests[1].message, /- snippet_range_invalid: S2:L2-L9 is not a valid line range \(S2 has lines 1-2/)
  const saved = drafts(s.store)[0].payload
  assert.ok(saved.post_markdown.includes(`\`\`\`bash\n${TUTORIAL_CODE}\n\`\`\`\n\nSource: [github.com: scripts/m91.sh](${SCRIPT})`))
  assert.ok(!saved.post_markdown.includes('#!/bin/sh'), 'only line 2')
  assert.deepEqual(saved.snippet_inserts.map((x) => [x.id, x.from, x.to]), [['S2', 2, 2]])
  assert.equal(saved.checks.results.find((x) => x.id === 'ai_written_code').passed, true)
  assert.equal(r.hard_passed, true)
})

test('message guard: a very long snippet (a whole script) is listed without its lines first; usage snippets stay', () => {
  const script = Array.from({ length: 700 }, (_, i) => `echo line ${i} ${'x'.repeat(60)}`).join('\n')
  const { snippets } = extractSnippets(`=== SOURCE: ${SCRIPT} ===\n# Usage: m91.sh check\n${script}`)
  const full = snippetSection(snippets)
  const compact = snippetSection(snippets, { maxLines: 60 })
  const { message, trimmed } = buildWriterMessage({ brief: '{}', tone: 't', allowedUrls: '- x', tutorialText: 'steps', snippets: full, snippetsCompact: compact })
  assert.ok(full.length > 50000)
  assert.ok(message.length <= 50000)
  assert.deepEqual(trimmed, ['long code snippets (listed without their lines)'])
  assert.match(message, /\[S1\] kind: file · language: bash · lines 1-701 · source: [^\n]+\ncontext: [^\n]*\n\(701 lines: too long to list here\. Do not insert S1 or a range of it; use the other snippets, e\.g\. its usage snippets\.\)/)
  assert.match(message, /\[S2\] kind: usage_from_comment · language: bash · lines 1-1 · source: [^\n]+\ncontext: [^\n]*\n```bash\n1\| m91\.sh check\n```/)
  assert.match(message, /--- TUTORIAL SOURCE TEXT ---\nsteps/, 'the source text is not trimmed when compacting is enough')
})

// ---------- acronyms in capitals (title, title_tag, meta_description) ----------

test('fixAcronyms: known acronyms in capitals, whole words only; links, domains and file names untouched', () => {
  assert.equal(fixAcronyms('How ai agents call an api over mcp with an sdk'), 'How AI agents call an API over MCP with an SDK')
  assert.equal(fixAcronyms('llm, sre, crm, json, url, http, sms, otp, m91 and iot'), 'LLM, SRE, CRM, JSON, URL, HTTP, SMS, OTP, M91 and IoT')
  assert.equal(fixAcronyms('IOT and Iot and Api'), 'IoT and IoT and API')
  assert.equal(fixAcronyms('Compare llms, apis, sdks, urls and otps'), 'Compare LLMs, APIs, SDKs, URLs and OTPs')
  assert.equal(fixAcronyms('AI-powered sre with url-safe ids'), 'AI-powered SRE with URL-safe ids')
  // Word boundaries: no change inside other words; https keeps its lowercase (no plural for HTTP).
  assert.equal(fixAcronyms('Maintain the main chain, then explain it again: Said, rail, sdkman, https'), 'Maintain the main chain, then explain it again: Said, rail, sdkman, https')
  // Links, domains, paths and file names stay exactly as written.
  assert.equal(fixAcronyms('see m91-api.msg91.com/llms.txt, https://m91-api.msg91.com/api/public/api.md and ops@m91.dev'), 'see m91-api.msg91.com/llms.txt, https://m91-api.msg91.com/api/public/api.md and ops@m91.dev')
  assert.equal(fixAcronyms(undefined), undefined)
})

test('autoFixDraft: acronyms fixed in title, title_tag and meta_description; the matching H1 follows the title; the body is untouched', () => {
  const title = 'How ai agents ask a human over an api'
  const d = {
    title,
    seo: { title_tag: 'Ai agent approval with an api', meta_description: 'Make your llm agent wait for a yes by sms or a call, then continue.', slug_suggestion: 'ai-agent-approval' },
    post_markdown: `# ${title}\n\nYour ai agent calls an api.\n\n## What to do next\n\n[Try M91](${CTA})\n`
  }
  const notes = autoFixDraft(d, { config: config(), brief: brief() })
  assert.equal(d.title, 'How AI agents ask a human over an API')
  assert.equal(d.seo.title_tag, 'AI agent approval with an API')
  assert.equal(d.seo.meta_description, 'Make your LLM agent wait for a yes by SMS or a call, then continue.')
  assert.equal(d.seo.slug_suggestion, 'ai-agent-approval', 'the slug stays lowercase')
  assert.ok(d.post_markdown.startsWith('# How AI agents ask a human over an API\n'), 'the H1 still equals the title')
  assert.ok(d.post_markdown.includes('Your ai agent calls an api.'), 'the body text is never changed')
  assert.deepEqual(notes, ['wrote acronyms in capitals in title', 'wrote acronyms in capitals in seo.title_tag', 'wrote acronyms in capitals in seo.meta_description'])
  // Already right: no change, no note.
  const ok = { title: 'How AI agents use an API', seo: { title_tag: 'AI and APIs', meta_description: 'IoT and M91.' }, post_markdown: `# How AI agents use an API\n\nText.\n\n## What to do next\n\n[Try M91](${CTA})\n` }
  assert.deepEqual(autoFixDraft(ok, { config: config(), brief: brief() }), [])
})

test('Writer prompt: one line asks for acronyms in capitals in the title, title_tag and meta_description', () => {
  assert.match(WRITER_BASE, /Write acronyms in capitals in the title, "title_tag" and "meta_description": AI, API, MCP, SDK, LLM, SRE, CRM, JSON, URL, HTTP, SMS, OTP, M91 \(IoT stays "IoT"\)\./)
})
