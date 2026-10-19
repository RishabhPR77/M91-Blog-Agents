// Writer smoke test (real network). Run through smoke/run.js: npm run smoke -- writer
// Uses existing briefs in Mem0 (question/story brief, and a tutorial brief if one exists):
//   1. new mode in DRY_RUN, then for real (the Slack line only goes out if SLACK_POST_WEBHOOK_URL is set
//      and DRY_RUN is false; set SLACK_POST_DRAFTS=true for the full post)
//   2. check table, words, grades, ms, model    3. first 40 lines of the draft
//   4. revise with 2 feedback items quoting real sentences: v2, revision notes, H2 lists compared
//   5. tutorial brief: every code block passed ai_written_code
// About 6 Writer calls (+ repairs). Steps 6–7 of the brief (pipeline fail_once, API run) are commands.

import { runWriter } from '../src/writer/index.js'
import { draftsOf } from '../src/writer/save.js'
import { createStore } from '../src/store.js'
import { createNotifier } from '../src/notify.js'
import { latestBriefs } from '../src/strategist/inputs.js'
import { parseMarkdown } from '../src/checks/content.js'
import { sampleSentences } from '../src/agents/stubs.js'

const checkTable = (results) => results.map((r) => ({ check: r.id, severity: r.severity, passed: r.passed ? 'yes' : 'NO', value: r.value, detail: String(r.detail ?? '').slice(0, 60) }))
const show = (label, r, ms) => {
  console.log(`\n-- ${label}: brief ${r.brief_id} v${r.brief_version} · draft v${r.version} · ${r.status} · ${ms} ms · model ${r.model_used} · ${r.word_count} words · grades intro ${r.reading.intro_grade} / post ${r.reading.post_grade} · repairs ${r.repairs_used}`)
  if (r.auto_fixes.length) console.log('auto-fixes:', r.auto_fixes)
  if (r.warnings.length) console.log('warnings:', r.warnings)
  console.table(checkTable(r.draft.checks.results))
}

export async function writerSmoke(config) {
  const store = createStore({ config })
  const notifier = createNotifier({ config })
  const dryConfig = Object.freeze({ ...config, runtime: Object.freeze({ ...config.runtime, dryRun: true }) })
  const briefs = latestBriefs(await store.getRecords({ type: 'brief' }))
  const pick = briefs.find((b) => ['question', 'story', 'rapid_response', 'pinned'].includes(b.payload?.post_type))
  if (!pick) throw new Error('no question/story brief in Mem0; run the Strategist first')
  const briefId = pick.payload.brief_id
  const out = {}

  // 1. Dry, then real.
  let t = Date.now()
  const dry = await runWriter({ mode: 'new', briefId, runId: `smoke-${briefId}` }, { config: dryConfig, store: createStore({ config: dryConfig }), notifier: createNotifier({ config: dryConfig }) })
  show('1a. new (DRY_RUN)', dry, Date.now() - t)
  t = Date.now()
  const real = await runWriter({ mode: 'new', briefId, runId: `smoke-${briefId}` }, { config, store, notifier })
  show('1b. new (live)', real, Date.now() - t)
  out.real = real

  // 3. First 40 lines.
  console.log('\n-- 3. first 40 lines of the draft:\n' + real.draft.post_markdown.split('\n').slice(0, 40).join('\n'))

  // 4. Revise with 2 quoted items.
  const quotes = sampleSentences(real.draft.post_markdown, 2)
  const feedback = [
    { area: 'clarity', quote: quotes[0], problem: 'This sentence is harder to follow than it needs to be.', fix: 'Say it in shorter, plainer words.', severity: 'must', send_to: 'writer' },
    { area: 'answer_first', quote: quotes[1], problem: 'The point comes too late here.', fix: 'Put the direct answer first.', severity: 'should', send_to: 'writer' }
  ]
  t = Date.now()
  const rev = await runWriter({ mode: 'revise', briefId, runId: `smoke-${briefId}`, feedback }, { config, store, notifier })
  show('4. revise', rev, Date.now() - t)
  console.log('revision notes:', rev.draft.revision_notes)
  const h2 = (md) => parseMarkdown(md).h2.map((h) => h.text)
  const before = h2(real.draft.post_markdown)
  const after = h2(rev.draft.post_markdown)
  console.log('H2 before:', before, '\nH2 after: ', after, `\nsame H2 list: ${JSON.stringify(before) === JSON.stringify(after) ? 'YES' : 'NO'}`)
  console.log('draft versions:', (await draftsOf(store, briefId)).map((d) => `v${d.version}:${d.status}`).join(' '))
  out.rev = rev

  // 5. Tutorial brief, if any.
  const tut = briefs.find((b) => b.payload?.post_type === 'tutorial')
  if (tut) {
    t = Date.now()
    const tr = await runWriter({ mode: 'new', briefId: tut.payload.brief_id, runId: `smoke-${tut.payload.brief_id}` }, { config, store, notifier })
    show('5. tutorial', tr, Date.now() - t)
    const v = tr.draft.checks.results.find((x) => x.id === 'ai_written_code')
    console.log(`ai_written_code: ${v?.passed ? 'PASSED' : 'FAILED'} (${v?.detail})`)
    out.tutorial = tr
  } else console.log('\n-- 5. no tutorial brief in Mem0 (skipped)')
  return out
}
