// Phase 8: the Designer agent with hand-written plans and a fake AI client (no AI calls, no Mem0, no network).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runDesigner, designerThreadId, isInteractive, latestBlockDoc, designerSummary, designableDraft } from '../../src/designer/index.js'
import { buildDesignerPrompt, buildDesignerMessage, DESIGNER_PROMPT } from '../../src/designer/prompts.js'
import { parseParts } from '../../src/designer/parts.js'
import { createRunManager } from '../../src/runs.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { resetEvents, replay } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { EVERY_BLOCK_MD, everyBlockPlan, seg, range } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const BRIEF = '261020-0900-DSGN'
const POST_MD = `# Approvals with one owner\n\n**TL;DR**\n- One.\n- Two.\n- Three.\n\n${EVERY_BLOCK_MD}`
const parts = parseParts(EVERY_BLOCK_MD).parts

async function setup({ status = 'approved', interactive, env = {} } = {}) {
  const config = fakeConfig(env)
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF, payload: { brief_id: BRIEF, brief_version: 1, titles: ['Approvals with one owner'], topic_group: 1, format: 'how_to', interactive_ideas: [{ block_type: 'steps_checklist', why: 'setup steps' }] }, status, version: 1 })
  const draft = await store.createRecord({ type: 'draft', briefId: BRIEF, payload: { title: 'Approvals with one owner', version: 2, brief_version: 1, post_markdown: POST_MD }, status, version: 2, meta: { brief_version: 1, ...(interactive !== undefined && { interactive }) } })
  return { config, store, draft }
}

/** A fake aiSend: answers in order; an Error answer is thrown. Records each call. */
function fakeAi(answers) {
  const calls = []
  const send = async (p) => {
    calls.push(p)
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return { content: a, model: 'gpt-5.6-luna', ms: 5, delivery: 'sync' }
  }
  send.calls = calls
  return send
}
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)

test('a good plan: blocks built, integrity passed, block_doc "ok" saved; one call with previews only', async () => {
  const restore = quiet()
  const s = await setup()
  const ai = fakeAi([everyBlockPlan(parts)])
  const out = await runDesigner({ briefId: BRIEF, runId: 'R-1' }, { config: fakeConfig({ DESIGNER_MAX_INTERACTIVE_BLOCKS: '10' }), store: s.store, aiSend: ai })
  restore()
  assert.equal(out.status, 'ok')
  assert.equal(out.kept.length, 10)
  assert.equal(out.integrity.passed, true)
  assert.equal(out.blocks.filter((b) => b.type !== 'rich_text').length, 10)
  assert.equal(ai.calls.length, 1)
  const call = ai.calls[0]
  assert.equal(call.agent, 'designer')
  assert.equal(call.jsonSchema.name, 'designer_plan')
  assert.match(call.threadId, /^designer-261020-0900-DSGN-v2-[a-z0-9]{4}$/)
  assert.equal(call.prompt, DESIGNER_PROMPT.replace('{{max_blocks}}', '10'))
  assert.ok(!call.message.includes('M91_SEND_LINK'), 'no full code or text in the message')
  assert.match(call.message, /=== PARTS \(in order\) ===\n\{"id":"N1","type":"heading","depth":2,"preview":"Why approvals need one owner"\}/)
  assert.match(call.message, /- steps_checklist: setup steps/)
  const [doc] = recordsOf(s.store, 'block_doc')
  assert.equal(doc.status, 'ok')
  assert.equal(doc.briefId, BRIEF)
  assert.equal(doc.version, 2)
  assert.deepEqual(doc.payload.blocks, out.blocks)
  assert.equal(doc.payload.parts.length, parts.length)
  assert.ok(doc.payload.created_at)
  assert.equal(out.summary_line, '10 blocks: callout, steps_checklist, phone_ring_sim, code_tabs, comparison_table, escalation_timeline, agent_terminal_replay, choice_explorer, faq_accordion, troubleshooting_picker · integrity passed')
})

test('an invalid plan is repaired once; a still-invalid plan falls back to plain text (blocks: null)', async () => {
  const restore = quiet()
  const s = await setup()
  const good = { segments: [seg('steps_checklist', range(parts, '1. Create a channel'))], notes: 'none' }
  const repaired = fakeAi([{ segments: 'nope' }, good])
  const ok = await runDesigner({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: repaired })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.repairs_used, 1)
  assert.equal(repaired.calls.length, 2)
  assert.match(repaired.calls[1].message, /YOUR PREVIOUS ANSWER DID NOT MATCH THE SCHEMA/)
  const bad = fakeAi([{ segments: 'nope' }, { segments: 'still nope' }])
  const fb = await runDesigner({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: bad })
  restore()
  assert.equal(bad.calls.length, 2, 'DESIGNER_MAX_REPAIRS=1: one call plus one repair')
  assert.equal(fb.status, 'fallback')
  assert.equal(fb.blocks, null)
  assert.match(fb.summary_line, /^fallback \(plain text\): the plan did not match the schema after 1 repair/)
  assert.ok(fb.warnings.some((w) => /Designer fallback, the post stays plain Markdown/.test(w)))
  assert.deepEqual(recordsOf(s.store, 'block_doc').map((d) => d.status), ['ok', 'fallback'])
})

test('a failed call or a failed integrity check falls back; nothing is thrown', async () => {
  const restore = quiet()
  const s = await setup()
  const failed = await runDesigner({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: fakeAi([Object.assign(new Error('500 from viaSocket'), { kind: 'server' })]) })
  assert.equal(failed.status, 'fallback')
  assert.match(failed.error, /the Designer call failed: 500 from viaSocket/)
  const broken = await runDesigner({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: fakeAi([everyBlockPlan(parts)]), integrity: () => ({ passed: false, details: ['no new text: injected'] }) })
  restore()
  assert.equal(broken.status, 'fallback')
  assert.equal(broken.blocks, null)
  assert.match(broken.error, /the integrity check failed: no new text: injected/)
  assert.match(broken.summary_line, /^fallback \(plain text\): 6 blocks: .* · integrity failed$/)
})

test('zero segments: status ok, blocks null (plain Markdown); dropped segments are warnings', async () => {
  const restore = quiet()
  const s = await setup()
  const none = await runDesigner({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: fakeAi([{ segments: [], notes: 'plain explanation only' }]) })
  const someDropped = await runDesigner({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: fakeAi([{ segments: [seg('faq_accordion', range(parts, '## Questions')), seg('steps_checklist', range(parts, '1. Create a channel'))], notes: 'none' }]) })
  restore()
  assert.equal(none.status, 'ok')
  assert.equal(none.blocks, null)
  assert.equal(none.summary_line, 'no interactive blocks · integrity passed')
  assert.equal(someDropped.kept.length, 1)
  assert.match(someDropped.warnings[0], /^Designer segment dropped \(faq_accordion N\d+\):/)
  assert.equal(someDropped.summary_line, '1 block: steps_checklist · 1 dropped · integrity passed')
})

test('drafts: approved or published; none → an error; interactive flag and default; newest block_doc', async () => {
  const restore = quiet()
  const pub = await setup({ status: 'published' })
  assert.ok(await designableDraft(pub.store, BRIEF))
  const waiting = await setup({ status: 'awaiting_human' })
  await assert.rejects(runDesigner({ briefId: BRIEF }, { config: waiting.config, store: waiting.store, aiSend: fakeAi([{}]) }), (e) => e.kind === 'no_draft' && e.status === 404)
  restore()
  const config = fakeConfig()
  assert.equal(isInteractive({ metadata: {} }, config), true)
  assert.equal(isInteractive({ metadata: { interactive: false } }, config), false)
  assert.equal(isInteractive({ metadata: {} }, fakeConfig({ INTERACTIVE_DEFAULT: 'false' })), false)
  const store = memoryStore()
  await store.createRecord({ type: 'block_doc', briefId: BRIEF, payload: { version: 2, created_at: '2026-10-20T10:00:00+05:30', tag: 'old' }, status: 'ok', version: 2 })
  await store.createRecord({ type: 'block_doc', briefId: BRIEF, payload: { version: 2, created_at: '2026-10-20T11:00:00+05:30', tag: 'new' }, status: 'fallback', version: 2 })
  await store.createRecord({ type: 'block_doc', briefId: BRIEF, payload: { version: 1, created_at: '2026-10-20T12:00:00+05:30', tag: 'v1' }, status: 'ok', version: 1 })
  assert.equal((await latestBlockDoc(store, BRIEF, 2)).payload.tag, 'new')
  assert.equal(await latestBlockDoc(store, BRIEF, 3), null)
  assert.match(designerThreadId(BRIEF, 2), /^designer-261020-0900-DSGN-v2-[a-z0-9]{4}$/)
  assert.equal(designerSummary({ status: 'fallback', error: 'x' }), 'fallback (plain text): x')
  assert.equal(buildDesignerPrompt(4).includes('At most 4 segments.'), true)
  assert.match(buildDesignerMessage({ parts, draft: { title: 'T' }, brief: {}, maxBlocks: 4 }), /INTERACTIVE IDEAS \(hints only\):\n- none/)
})

test('designer run mode: 202-style start, the Designer step and its summary; no draft → 409 before the run', async () => {
  const restore = quiet()
  const s = await setup({ status: 'published' })
  const ai = fakeAi([{ segments: [seg('steps_checklist', range(parts, '1. Create a channel'))], notes: 'none' }])
  const manager = createRunManager({
    config: s.config, storeFactory: () => s.store, notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, { store }) => ({ ...stubAgents, reviewer: mockReviewer(), designer: async (ctx) => ({ output: await runDesigner({ briefId: ctx.briefId, runId: ctx.runId, version: ctx.draft?.version }, { config: rc, store, aiSend: ai }) }) })
  })
  const { run_id } = await manager.startRun({ mode: 'designer', params: { brief_id: BRIEF } })
  const r = await manager.wait(run_id)
  await assert.rejects(manager.startRun({ mode: 'designer', params: { brief_id: '261020-0900-NONE' } }), (e) => e.code === 'no_draft' && e.status === 409)
  restore()
  assert.equal(r.status, 'succeeded')
  assert.equal(r.run.result_summary, `Designer for ${BRIEF} v2: 1 block: steps_checklist · integrity passed`)
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status, x.summary]), [['designer', 'succeeded', '1 block: steps_checklist · integrity passed']])
  const out = replay(run_id).find((e) => e.type === 'step.output' && e.step === 'designer')
  assert.deepEqual(out.data, { record_id: out.data.record_id, status: 'ok', blocks: 1, dropped: 0, integrity: true, repairs_used: 0 })
})

test('the CLI printout: kept blocks with why, dropped with reasons, integrity, block ids', async () => {
  const { printDesigner } = await import('../../src/cli.js')
  const lines = []
  printDesigner({ brief_id: BRIEF, version: 2, status: 'ok', model_used: 'gpt-5.6-luna', repairs_used: 0, record_id: 'mem-9', summary_line: '1 block: steps_checklist · 1 dropped · integrity passed', kept: [{ block_type: 'steps_checklist', part_ids: ['N4'], why: 'setup steps' }], dropped: [{ block_type: 'faq_accordion', part_ids: ['N20'], reason: 'faq_accordion: N20 must be an H3 question' }], integrity: { passed: true, details: [] }, blocks: [{ id: 'b1', type: 'rich_text' }, { id: 'b2', type: 'steps_checklist' }] }, (l) => lines.push(l))
  assert.deepEqual(lines.slice(2), ['KEPT (1)', '  steps_checklist N4: setup steps', 'DROPPED (1)', '  faq_accordion N20: faq_accordion: N20 must be an H3 question', 'INTEGRITY passed', 'BLOCKS b1 rich_text · b2 steps_checklist'])
})
