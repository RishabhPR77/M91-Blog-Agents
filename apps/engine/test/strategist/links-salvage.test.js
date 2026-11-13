// A brief never stops a run on a mechanical problem (R-261113-1131-JTR8 stopped on one re-spelled Reddit link):
// autoFix puts a near-miss link back to the input's spelling and leaves out links the inputs do not have; when the
// model's repairs leave problems, code makes every safe fix it can before the brief would fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInputs } from '../../src/strategist/inputs.js'
import { autoFix, findProblems, salvageBrief } from '../../src/strategist/checks.js'
import { runStrategist, StrategistError } from '../../src/strategist/index.js'
import { setSink } from '../../src/util/log.js'
import { fakeNotifier } from '../helpers.js'
import { NOW, ISSUE, LLMS, SCRIPT, STORY_URL, config, seededStore, validBrief, fakeAi } from './fixtures.js'

const now = () => NOW
async function setup() {
  const cfg = config()
  const store = await seededStore()
  const inputs = await buildInputs({ config: cfg, store, now })
  return { cfg, store, inputs }
}

test('autoFix: a re-spelled input link is put back; a link the inputs do not have is left out', async () => {
  const { cfg, inputs } = await setup()
  const mangled = SCRIPT.replace('m91-skill', 'm91_skill').replace('https://github.com', 'https://www.github.com') + '/'
  const { brief, fixes } = autoFix(validBrief({
    sources: [{ url: mangled, what_it_supports: 'the script' }, { url: 'https://www.reddit.com/r/x/comments/1abc/made-up/', what_it_supports: 'x' }, { url: ISSUE, what_it_supports: 'the question' }],
    outline: validBrief().outline.map((s, i) => (i === 0 ? { ...s, source_urls: [ISSUE, 'https://made-up.example.com/y'] } : s))
  }), { config: cfg, inputs })
  assert.deepEqual(brief.sources.map((s) => s.url), [SCRIPT, ISSUE])
  assert.deepEqual(brief.outline[0].source_urls, [ISSUE])
  assert.ok(fixes.some((f) => f.includes(`→ ${SCRIPT} (spelled as in the inputs)`)))
  assert.ok(fixes.some((f) => /left out source https:\/\/www\.reddit\.com.*not in the inputs/.test(f)))
  assert.ok(fixes.some((f) => /left out outline\[0\] link https:\/\/made-up\.example\.com\/y/.test(f)))
  const problems = await findProblems(brief, { config: cfg, inputs })
  assert.ok(!problems.some((p) => /not in the inputs/.test(p)), problems.join('\n'))
})

test("salvage: the story copied from its record, extra ideas cut, invented facts left out; judgment problems stay", async () => {
  const { cfg, inputs } = await setup()
  const bad = validBrief({
    story: { use: true, story_id: 'S-1', attribution_line: 'from the news', source_url: STORY_URL, how_to_use: 'as an example' },
    interactive_ideas: Array.from({ length: 6 }, () => ({ block_type: 'phone_ring_sim', why: 'helps' })),
    m91_facts_to_use: [{ fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: LLMS }, { fact: 'M91 has 10 million users worldwide.', source_url: LLMS }]
  })
  const before = await findProblems(bad, { config: cfg, inputs })
  assert.ok(before.some((p) => /attribution_line must be copied exactly/.test(p)))
  assert.ok(before.some((p) => /interactive_ideas has 6 items/.test(p)))
  assert.ok(before.some((p) => /does not match any M91 fact/.test(p)))
  const { brief, fixes } = salvageBrief(bad, { config: cfg, inputs })
  assert.deepEqual(await findProblems(brief, { config: cfg, inputs }), [])
  assert.equal(brief.interactive_ideas.length, 4)
  assert.equal(brief.m91_facts_to_use.length, 1)
  assert.ok(fixes.some((f) => /story source and attribution copied/.test(f)))

  const lead = salvageBrief(validBrief({ lead: { kind: 'cluster', id: 'C-404' } }), { config: cfg, inputs })
  assert.ok((await findProblems(lead.brief, { config: cfg, inputs })).some((p) => /C-404/.test(p)), 'a wrong lead is not "fixed"')
})

test('runStrategist: the repair still has a mechanical problem → code fixes it and the brief is saved', async () => {
  const restore = setSink(() => {})
  const store = await seededStore()
  const cfg = config()
  store.setDryRun(cfg.runtime.dryRun)
  const bad = validBrief({
    sources: [{ url: 'https://www.reddit.com/r/AI_Agents/comments/1xqrjtx/which-agent-actions/', what_it_supports: 'x' }, { url: ISSUE, what_it_supports: 'the question' }],
    story: { use: true, story_id: 'S-1', attribution_line: 'from the news', source_url: STORY_URL, how_to_use: 'as an example' }
  })
  const ai = fakeAi({ plan: bad, repair: bad })
  try {
    const r = await runStrategist({ mode: 'plan', runId: '261017-1405-ABCD' }, { config: cfg, store, notifier: fakeNotifier(), aiSend: ai, now })
    assert.deepEqual(ai.requests.map((q) => q.call), ['plan', 'repair'])
    assert.equal(r.brief.story.attribution_line, 'reported by Example News', 'copied from the story record')
    assert.ok(!r.brief.sources.some((s) => /reddit/.test(s.url)), 'the unknown link was left out')
    assert.ok(r.warnings.some((w) => /^brief fixed by code after 1 repair\(s\): story source and attribution copied/.test(w)))
  } finally {
    restore()
  }
})

test('runStrategist: a problem that needs judgment still fails the brief after the repair', async () => {
  const restore = setSink(() => {})
  const store = await seededStore()
  const cfg = config()
  store.setDryRun(cfg.runtime.dryRun)
  const bad = validBrief({ lead: { kind: 'cluster', id: 'C-404' } })
  try {
    await assert.rejects(runStrategist({ mode: 'plan', runId: '261017-1405-ABCD' }, { config: cfg, store, notifier: fakeNotifier(), aiSend: fakeAi({ plan: bad, repair: bad }), now }), (e) => e instanceof StrategistError && /C-404/.test(e.message))
  } finally {
    restore()
  }
})
