// Phase 5 smoke tests (real network; ask before running). Run: npm run smoke -- reviewer
//   2. tutorial fix: the Writer on a tutorial brief in DRY_RUN — only snippet code, ai_written_code passes,
//      every inserted block followed by its "Source:" line
//   3. the Reviewer alone on the latest draft of SMOKE_REVIEW_BRIEF (default: the pinned brief)
//   4. strictness: the Reviewer on the latest draft of SMOKE_STRICT_BRIEF (default: the with-issues
//      tutorial draft) — it must fail with checks_hard_passed false and clear "must" items
// Steps 3–4 run in DRY_RUN too (no review records or lessons saved): about 2 Reviewer calls (gpt-5.5)
// and 1–2 Writer calls. Step 1 (cleanup --list) and step 5 (the full pipeline) are commands.

import { runWriter } from '../src/writer/index.js'
import { runReviewer } from '../src/reviewer/index.js'
import { createStore } from '../src/store.js'
import { createNotifier } from '../src/notify.js'
import { printReview } from '../src/cli.js'
import { parseMarkdown } from '../src/checks/content.js'

const TUTORIAL_BRIEF = process.env.SMOKE_TUTORIAL_BRIEF || '261017-2258-8CDR'
const REVIEW_BRIEF = process.env.SMOKE_REVIEW_BRIEF || '261017-2301-L6GD'
const STRICT_BRIEF = process.env.SMOKE_STRICT_BRIEF || TUTORIAL_BRIEF

export async function reviewerSmoke(config) {
  const dryConfig = Object.freeze({ ...config, runtime: Object.freeze({ ...config.runtime, dryRun: true }) })
  const store = createStore({ config: dryConfig, testTag: true })
  const notifier = createNotifier({ config: dryConfig })
  const out = {}

  console.log(`\n-- 2. tutorial fix: Writer (DRY_RUN) on ${TUTORIAL_BRIEF}`)
  let t = Date.now()
  const tr = await runWriter({ mode: 'new', briefId: TUTORIAL_BRIEF, runId: `smoke-${TUTORIAL_BRIEF}` }, { config: dryConfig, store, notifier })
  const md = tr.draft.post_markdown
  const blocks = parseMarkdown(md).code
  const lines = md.split('\n')
  const fenceEnds = lines.map((l, i) => (/^```\s*$/.test(l) ? i : -1)).filter((i) => i >= 0)
  const sourced = fenceEnds.filter((i) => /^Source: \[.+\]\(https?:\/\/\S+\)$/.test(lines[i + 2] ?? '')).length
  const awc = tr.draft.checks.results.find((x) => x.id === 'ai_written_code')
  console.log(`${Date.now() - t} ms · ${tr.model_used} · ${tr.word_count} words · repairs ${tr.repairs_used} · hard checks ${tr.hard_passed ? 'passed' : 'FAILED'}`)
  console.log(`snippets available ${tr.draft.snippets_available} · used ${tr.draft.snippets_used.join(', ') || 'none'} · code blocks ${blocks.length} · blocks with a Source line ${sourced}`)
  console.log(`ai_written_code: ${awc?.passed ? 'PASSED' : 'FAILED'} (${awc?.detail})`)
  for (const r of tr.draft.checks.results.filter((x) => !x.passed)) console.log(`  ${r.severity} ${r.id}: ${r.detail}`)
  out.tutorial = { result: tr, blocks: blocks.length, sourced, awc }

  for (const [label, briefId] of [['3. Reviewer alone', REVIEW_BRIEF], ['4. strictness', STRICT_BRIEF]]) {
    console.log(`\n-- ${label}: Reviewer (DRY_RUN) on the latest draft of ${briefId}`)
    t = Date.now()
    const r = await runReviewer({ briefId, runId: `smoke-${briefId}` }, { config: dryConfig, store })
    printReview(r)
    out[label.startsWith('3') ? 'review' : 'strict'] = { ...r, wall_ms: Date.now() - t }
  }
  return out
}
