// Scout smoke test (real network). Run through smoke/run.js:
//   DRY_RUN first:  $env:DRY_RUN="true"; npm run smoke -- scout     (PowerShell)
//                   npx cross-env DRY_RUN=true npm run smoke -- scout
//   then for real:  npm run smoke -- scout        (posts the Slack summary unless DRY_RUN=true)
// Steps (brief 17): research run, call table, samples, immediate re-run (must reuse, no duplicates),
// sources mode with one true and one made-up claim, Mem0 record counts and a duplicate check.

import { runScout } from '../src/scout/index.js'
import { createStore } from '../src/store.js'
import { createNotifier } from '../src/notify.js'

const table = (calls) => calls.map((c) => ({
  call: c.call, model: c.model, delivery: c.delivery, ms: c.ms,
  returned: c.items_returned, kept: c.items_kept, dropped: c.items_dropped, retries: c.retries,
  error: c.error ? String(c.error).slice(0, 60) : ''
}))

async function snapshot(store) {
  const types = ['m91_facts', 'question_cluster', 'story_lead', 'tutorial_lead', 'tone_profile', 'source_pack', 'run_log']
  const out = {}
  for (const t of types) out[t] = await store.getRecords({ type: t })
  return out
}

function duplicates(records, keyOf) {
  const seen = new Map()
  for (const r of records) {
    const k = keyOf(r)
    if (!k) continue
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1)
}

export async function scoutSmoke(config) {
  const store = createStore({ config, testTag: true })
  const notifier = createNotifier({ config })
  const dry = config.runtime.dryRun
  console.log(`\n=== Scout smoke (${dry ? 'DRY_RUN: nothing saved except run_log, no Slack' : 'LIVE: saves to Mem0 and posts the Slack summary'}) ===`)
  const before = dry ? null : await snapshot(store)

  // 1–2. Research run + call table
  const t1 = Date.now()
  const first = await runScout({ mode: 'research' }, { config, store, notifier })
  console.log(`\n-- Research run ${first.run_id}: ${Date.now() - t1} ms, ${first.calls_used} calls, reused=${first.reused}`)
  console.table(table(first.calls))
  const slowest = first.calls.filter((c) => c.ms).sort((a, b) => b.ms - a.ms)[0]
  console.log(`Slowest call: ${slowest?.call} (${slowest?.ms} ms, ${slowest?.delivery})`)
  console.log('Counts:', first.counts, '\nWarnings:', first.warnings)

  // 3. Samples
  const facts = (await store.getRecords({ type: 'm91_facts', status: 'current' }))[0]?.payload
  if (facts) console.log(`\nFacts: can ${facts.can.length}, cannot ${facts.cannot.length}, integrations ${facts.integrations.length}, contradictions ${facts.contradictions.length}, pages ${facts.pages_fetched}, chars ${facts.chars}`)
  console.log('\nTop clusters:', first.top_clusters)
  if (!dry) {
    const clusters = (await store.getRecords({ type: 'question_cluster', status: 'open' })).slice(0, 3)
    for (const c of clusters) console.log(`- ${c.payload.main_question} | group ${c.payload.topic_group} | fit ${c.payload.m91_fit?.score} | demand ${c.payload.demand?.level} | ${c.payload.source_urls.map((u) => `${u.url} [${u.url_status}]`).join(', ')}`)
    console.log('\nStory leads:')
    for (const s of await store.getRecords({ type: 'story_lead', status: 'open' })) console.log(`- ${s.payload.title} | ${s.payload.source_url} [${s.payload.url_status}] | ${s.payload.published_date} | ${s.payload.attribution_line}`)
    console.log('\nTutorial leads:')
    for (const t of await store.getRecords({ type: 'tutorial_lead', status: 'open' })) console.log(`- ${t.payload.title} | ${t.payload.target} | gaps: ${t.payload.gaps.join('; ') || '(none)'}`)
    const tone = (await store.getRecords({ type: 'tone_profile', status: 'current' }))[0]
    if (tone) console.log('\nStyle notes from:', tone.payload.based_on.map((b) => `${b.title} (${b.engagement_signal}) ${b.url} [${b.url_status}]`))
  } else {
    console.log('(DRY_RUN: samples are in the scout call log lines above; nothing was saved.)')
  }

  // 4. Immediate re-run: must reuse (no question calls) and create no duplicates
  const second = await runScout({ mode: 'research' }, { config, store, notifier })
  const questionCalls = second.calls.filter((c) => c.call.startsWith('questions')).length
  console.log(`\n-- Re-run ${second.run_id}: reused=${second.reused}, question calls=${questionCalls}, calls=${second.calls_used}`)
  console.table(table(second.calls))
  if (dry) console.log('(DRY_RUN: reuse needs a saved, non-dry research run, so a dry re-run does not reuse.)')

  // 5. Sources mode: one true fact from the docs, one made-up claim
  const trueClaim = facts?.can?.[0]?.fact ?? 'M91 rings a phone when software needs a human decision.'
  const fakeClaim = 'M91 was founded in 1987 on a research ship in the Arctic Ocean.'
  const src = await runScout({ mode: 'sources', briefId: `smoke-${first.run_id}`, version: 1, claims: [trueClaim, fakeClaim], reviewerNote: 'smoke test' }, { config, store, notifier })
  console.log('\n-- Sources mode')
  for (const c of src.claims) console.log(`- ${c.verdict.toUpperCase()}: ${c.claim}\n    ${c.results.map((r) => `${r.verdict} ${r.url} [${r.url_status}]`).join('\n    ') || '(no results)'}`)
  console.log(`supported ${src.claims_supported}, unverified ${src.claims_unverified}, contradicted ${src.claims_contradicted}`)

  // 6. Mem0 counts and duplicate check
  if (!dry) {
    const after = await snapshot(store)
    console.log('\n-- Mem0 records (before → after)')
    console.table(Object.fromEntries(Object.keys(after).map((t) => [t, { before: before[t].length, after: after[t].length, created: after[t].length - before[t].length }])))
    const dupClusters = duplicates(after.question_cluster, (r) => r.payload?.main_question?.toLowerCase())
    const dupStories = duplicates(after.story_lead, (r) => r.payload?.source_url)
    const dupTutorials = duplicates(after.tutorial_lead, (r) => `${r.payload?.target}|${r.payload?.title}`.toLowerCase())
    console.log(`Duplicates: clusters ${dupClusters.length}, stories ${dupStories.length}, tutorials ${dupTutorials.length}`)
    if (dupClusters.length || dupStories.length || dupTutorials.length) console.log({ dupClusters, dupStories, dupTutorials })
  }

  return { first, second, src, slowest }
}
