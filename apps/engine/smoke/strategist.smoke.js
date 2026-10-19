// Strategist smoke test (real network, ~6 AI calls, no web search). Run through smoke/run.js:
//   npm run smoke -- strategist              uses the Scout data already in Mem0 (today's m91_facts needed)
// Steps (Phase 3 brief, 17): dry plan → live plan → second plan (different lead, balance) →
// re-brief (angle) → re-brief (duplicate) → pinned topic. The Slack brief message only goes out when
// SLACK_POST_WEBHOOK_URL is set and DRY_RUN is false.

import { runStrategist } from '../src/strategist/index.js'
import { createStore } from '../src/store.js'
import { createNotifier } from '../src/notify.js'
import { newRecordId } from '../src/util/ids.js'
import { istDate } from '../src/util/time.js'

const show = (label, r) => {
  console.log(`\n-- ${label}: brief ${r.brief_id} v${r.brief_version} · ${r.post_type} · group ${r.topic_group} · lead ${r.lead.kind} ${r.lead.id} · repairs ${r.repairs_used}`)
  console.table(r.calls.map((c) => ({ call: c.call, model: c.model, delivery: c.delivery, ms: c.ms, result: c.result, problems: (c.problems ?? []).length })))
  if (r.auto_fixes.length) console.log('auto-fixes:', r.auto_fixes)
  for (const c of r.calls) if (c.problems?.length) console.log(`problems (${c.call}):`, c.problems)
  if (r.warnings.length) console.log('warnings:', r.warnings)
}

export async function strategistSmoke(config) {
  const store = createStore({ config, testTag: true })
  const notifier = createNotifier({ config })
  const dryConfig = Object.freeze({ ...config, runtime: Object.freeze({ ...config.runtime, dryRun: true }) })
  const out = {}

  // 1. Dry plan, then a live plan.
  const dry = await runStrategist({ mode: 'plan' }, { config: dryConfig, store: createStore({ config: dryConfig, testTag: true }), notifier: createNotifier({ config: dryConfig }) })
  show('1a. plan (DRY_RUN)', dry)
  const first = await runStrategist({ mode: 'plan' }, { config, store, notifier })
  show('1b. plan (live)', first)
  console.log('\nFull brief:\n' + JSON.stringify(first.brief, null, 2))
  out.first = first

  // 3. Second plan must pick a different lead.
  const second = await runStrategist({ mode: 'plan' }, { config, store, notifier })
  show('3. second plan', second)
  console.log(`different lead: ${second.lead.id !== first.lead.id ? 'YES' : 'NO'} (${first.lead.id} → ${second.lead.id}); groups ${first.topic_group} → ${second.topic_group}`)
  out.second = second

  // 4. Re-brief: angle feedback → same lead, new angle, v2, v1 superseded.
  const angle = await runStrategist({ mode: 'rebrief', runId: first.brief_id, briefId: first.brief_id, briefVersion: 1,
    feedback: [{ area: 'angle', problem: 'the angle repeats what every article says', fix: 'give the reader something typical articles skip', send_to: 'strategist' }] }, { config, store, notifier })
  show('4. re-brief (angle)', angle)
  console.log(`same lead: ${angle.lead.id === first.lead.id ? 'YES' : 'NO'} · angle before: "${first.brief.angle}"\n  angle after:  "${angle.brief.angle}"`)
  out.angle = angle

  // 5. Re-brief: duplicate feedback → a different lead, old lead discarded.
  const dup = await runStrategist({ mode: 'rebrief', runId: second.brief_id, briefId: second.brief_id, briefVersion: 1,
    feedback: [{ area: 'topic', problem: 'duplicate topic: already covered', fix: 'pick a different lead', send_to: 'strategist' }] }, { config, store, notifier })
  show('5. re-brief (duplicate)', dup)
  out.dup = dup

  // 6. Pinned topic due today that the M91 facts support.
  const pin = { pinned_id: newRecordId('PIN'), topic: 'How M91 keeps ringing a phone through silent mode until someone answers', target_date: istDate(), priority: 'high', notes: 'smoke test' }
  await store.createRecord({ type: 'pinned_topic', briefId: null, payload: pin, status: 'open' })
  const pinned = await runStrategist({ mode: 'plan' }, { config, store, notifier })
  show('6. pinned plan', pinned)
  console.log(`picked the pinned topic: ${pinned.lead.id === pin.pinned_id ? 'YES' : 'NO'}`)
  out.pinned = pinned

  // 7. Mem0: briefs and lead statuses.
  console.log('\n-- Mem0 briefs')
  for (const b of await store.getRecords({ type: 'brief' })) console.log(`${b.payload?.brief_id} v${b.payload?.brief_version} · ${b.status} · ${b.payload?.lead?.kind} ${b.payload?.lead?.id} · "${b.payload?.titles?.[0]}"`)
  console.log('\n-- Lead statuses')
  for (const t of ['question_cluster', 'story_lead', 'tutorial_lead', 'pinned_topic']) {
    for (const r of await store.getRecords({ type: t })) {
      const id = r.payload?.cluster_id ?? r.payload?.story_id ?? r.payload?.tutorial_id ?? r.payload?.pinned_id
      console.log(`${t} ${id}: ${r.status}${r.payload?.used_by ? ` (used_by ${r.payload.used_by})` : ''}`)
    }
  }
  return out
}
