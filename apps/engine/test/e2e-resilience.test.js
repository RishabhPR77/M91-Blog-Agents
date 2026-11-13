// Whole weekly runs, end to end, through the real Scout, Editor, Strategist, Writer, checks and Reviewer with fake AI:
// the problems that stopped real runs on 2026-11-13 come in together, and the run still reaches a post for you.
//   R-261113-0914-RUDY  the Writer's repair went over viaSocket's 50,000 characters
//   R-261113-1028-TSMC  the Reviewer's message went over 50,000 characters
//   R-261113-1131-JTR8  the Strategist cited a re-spelled link and its repair did not fix it
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../src/runs.js'
import { defaultAgents } from '../src/orchestrator.js'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeNotifier } from './helpers.js'
import { fakeAi as scoutAi, fakeWeb, fakeChecker, LLMS, VALID } from './scout/fixtures.js'
import { seededStore, fakeAi as strategistAi, validBrief, CTA, ISSUE, STORY_URL } from './strategist/fixtures.js'
import { fakeAi as writerAi, draftAnswer, GOOD_MD } from './writer/fixtures.js'
import { fakeReviewerAi, reviewAnswer, item } from './reviewer/fixtures.js'

const NOW = Date.parse('2026-10-17T08:35:00Z')
const done = (opts, content) => ({ content: structuredClone(content), threadId: opts.threadId, messageId: 'm', finishReason: 'completed', model: 'fake', ms: 3, delivery: 'sync', parseFixes: [] })
const LONG_SENTENCE = ' When the phone rings in the middle of the night the person who answers should be able to understand the question, check the details on the screen, and say yes or no without opening a laptop first.'

beforeEach(() => resetEvents())

/** One full run. strategist(lead) → the brief the model returns (plan and repair); writer, reviewer: fake answers. */
async function e2e({ env = {}, strategist, writer = {}, reviews = [reviewAnswer()], web = fakeWeb(), store: given } = {}) {
  const restore = setSink(() => {})
  // As the engine runs live: interactive guides off, the best version sent on when no version passes.
  const config = fakeConfig({ M91_DOCS_URL: LLMS, M91_CTA_URL: CTA, TARGET_WORDS_MIN: '180', TARGET_WORDS_MAX: '500', AI_MAX_RETRIES: '1', EXPERIENCE_ENABLED: 'false', APPROVE_BEST_ON_FAIL: 'true', ...env })
  const store = given ?? (await seededStore())
  // The Strategist plans the editor's pick: its lead is the cluster the focused Scout just made.
  const lead = (opts) => opts.message.match(/--- QUESTION CLUSTERS ---\n\[\{"cluster_id":"([^"]+)"/)?.[1] ?? 'C-1'
  const brief = (n, opts) => strategist(lead(opts))
  const ai = {
    scout: scoutAi({ 'questions-slot': { ...VALID.scout_slot_questions, related_questions: [{ question: 'How does agent approval work?', source_url: ISSUE, demand_evidence: '12 comments' }] } }),
    editor: async (opts) => done(opts, { candidates: [{ title: 'When should an AI agent call a human?', question: 'When should an AI agent call a human?', format: 'explainer', angle: 'a phone call, not a chat ping', hook_id: '', evidence_ids: ['q1', 'i1'], why_now: 'asked this week', scores: { demand: 4, timeliness: 3, m91_fit: 5, gap: 4, variety: 3 } }], choice: 0, reason: 'People asked this week.' }),
    strategist: strategistAi({ plan: brief, repair: brief }),
    writer: writerAi(writer),
    reviewer: fakeReviewerAi(reviews.map(live))
  }
  const requests = []
  const aiSend = async (opts) => {
    const agent = opts.agent ?? String(opts.threadId).split('-')[0]
    requests.push({ agent, call: opts.call ?? null, threadId: opts.threadId, length: String(opts.message ?? '').length })
    return ai[agent](opts)
  }
  const manager = createRunManager({
    config,
    now: () => NOW,
    storeFactory: () => store,
    notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, d) => defaultAgents({ config: rc, ...d, agentDeps: { aiSend, fetch: web, urlChecker: fakeChecker({}), now: () => NOW } })
  })
  try {
    const { run_id } = await manager.startRun({ mode: 'full' })
    const r = await manager.wait(run_id)
    return { r, store, requests, warnings: r.run?.warnings ?? [] }
  } finally {
    restore()
  }
}

// Interactive guides are off (as live): the Reviewer answers without the design gate and the experience area.
const live = (answer) => ({ ...answer, gates: answer.gates.filter((g) => g.id !== 'no_new_facts_in_design'), areas: answer.areas.filter((x) => x.id !== 'experience') })

const quote = GOOD_MD.split('\n').find((l) => l.startsWith('Agent approval means')).split('. ')[0] + '.'

test('every failure of 2026-11-13 at once: bad links, a story line not copied, a Writer repair, a failed first review → a post for you', async () => {
  // The model re-spells a link the inputs have, adds one they do not, and miscopies the story line, in the plan and
  // again in its repair.
  const strategist = (lead) => validBrief({
    lead: { kind: 'cluster', id: lead }, terms_to_define: [], why_today: 'People asked this week.',
    sources: [{ url: ISSUE.replace('https://github.com', 'https://www.github.com') + '/', what_it_supports: 'the question' }, { url: 'https://www.reddit.com/r/AI_Agents/comments/1xqrjtx/which-agent-actions/', what_it_supports: 'x' }, { url: LLMS, what_it_supports: 'ringing' }],
    story: { use: true, story_id: 'S-1', attribution_line: 'from the news', source_url: STORY_URL, how_to_use: 'as a short example' }
  })
  // The Writer's first draft breaks a major check (first person); its repair fixes it.
  const writer = { new: draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', "We've seen that a pause keeps") }) }
  const reviews = [reviewAnswer({ scores: { simplicity: 5 }, gates: { no_invented_content: false }, feedback: [item({ quote, severity: 'must' })] }), reviewAnswer()]
  const { r, requests, warnings } = await e2e({ strategist, writer, reviews })

  assert.equal(r.status, 'succeeded', `${r.error ?? ''}\n${warnings.join('\n')}`)
  assert.match(r.run.result_summary, /v2/, r.run.result_summary)
  // The Strategist: one repair, then code fixed the rest.
  assert.deepEqual(requests.filter((q) => q.agent === 'strategist').map((q) => q.call ?? q.threadId.split('-').at(-2)), ['plan', 'repair'])
  // A weekly brief has no story leads in its inputs: the invented story is left out (it would be copied from its
  // record if it were one).
  assert.ok(warnings.some((w) => /^Strategist: brief fixed by code after 1 repair\(s\): story left out: not a story in the inputs/.test(w)), warnings.join('\n'))
  // The Writer's repair continued the thread of the draft it repaired, with a short message.
  const w = requests.filter((q) => q.agent === 'writer')
  const repair = w.find((q) => q.call === 'repair')
  assert.ok(repair, w.map((q) => q.call).join(','))
  assert.equal(repair.threadId, w.find((q) => q.call === 'new').threadId)
  assert.ok(repair.length < 3000, `repair message ${repair.length} characters`)
  // Every message stayed under viaSocket's limit.
  for (const q of requests) assert.ok(q.length <= 50000, `${q.agent} ${q.call ?? ''}: ${q.length} characters`)
})

test('the Reviewer never passes and every draft has one long sentence: the best version still goes ahead', async () => {
  const strategist = (lead) => validBrief({ lead: { kind: 'cluster', id: lead }, terms_to_define: [], why_today: 'People asked this week.' })
  const longer = draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', `${LONG_SENTENCE.trim()} A pause keeps`) })
  // Each review fails a gate, so each version goes back to the Writer (a low area alone would go to you as notes).
  const fail = (total) => reviewAnswer({ scores: { simplicity: total }, gates: { no_invented_content: false }, feedback: [item({ quote, severity: 'must' })] })
  const { r, warnings } = await e2e({ strategist, writer: { new: longer, revise: { ...longer, revision_notes: [{ feedback_quote: 'q', what_changed: 'w' }] } }, reviews: [fail(5), fail(6), fail(5)], env: { MAX_WRITER_REVISIONS: '2' } })
  assert.equal(r.status, 'succeeded', `${r.error ?? ''}\n${warnings.join('\n')}`)
  assert.ok(!warnings.some((w) => /failed its hard content checks/.test(w)), warnings.join('\n'))
  assert.match(r.run.result_summary, /best/i, r.run.result_summary)
})

test("M91's docs are down and only yesterday's facts exist: the run uses them and still reaches a post", async () => {
  const store = await seededStore()
  for (const rec of store.records.values()) if (rec.type === 'm91_facts') rec.date = '2026-10-16'
  const strategist = (lead) => validBrief({ lead: { kind: 'cluster', id: lead }, terms_to_define: [], why_today: 'People asked this week.' })
  const { r, warnings } = await e2e({ strategist, store, web: fakeWeb({ llmsStatus: 500 }) })
  assert.equal(r.status, 'succeeded', `${r.error ?? ''}\n${warnings.join('\n')}`)
  assert.ok(warnings.some((w) => /^Scout: M91 facts not rebuilt today \(.+\): using the facts from 2026-10-16$/.test(w)), warnings.join('\n'))
})
