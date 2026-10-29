// One post, one journey: Topic → Research → Plan → Draft → AI review → You → Export → Published. Built from the
// post's records (brief, drafts, reviews, export, published post) and every run that worked on it, so the greens of
// the pipeline run and of the approve run show on one bar (GET /api/journeys). 0 AI calls, no writes.

export const STAGES = Object.freeze([
  ['topic', 'Topic'], ['research', 'Research'], ['plan', 'Plan'], ['draft', 'Draft'],
  ['review', 'AI review'], ['you', 'You'], ['export', 'Export'], ['published', 'Published']
])

// The run step that does each stage (for its run link and time).
const STEP_STAGE = { scout: 'research', strategist: 'plan', writer: 'draft', designer: 'draft', reviewer: 'review', export: 'export', publisher: 'published' }

const ver = (r) => Number(r?.payload?.version ?? r?.version ?? 0)
const bver = (r) => Number(r?.payload?.brief_version ?? r?.metadata?.brief_version ?? 1)
const at = (r) => r?.createdAt ?? r?.date ?? null

/**
 * briefs, drafts (newest first), reviews, exportRec, published (published_post records), runs (run records of this
 * brief), target (PUBLISH_TARGET), pick (the weekly editor's decision for this post, or null).
 * Returns { title, status, stages: [{ id, label, state, detail, run_id, at }], runs, active_run_id }.
 * state: done | current (a run is on it) | waiting (needs you) | failed | todo | off.
 */
export function buildJourney({ briefs = [], drafts = [], reviews = [], exportRec = null, published = [], runs = [], target = 'embarko', pick = null }) {
  const brief = [...briefs].sort((a, b) => bver(b) - bver(a))[0] ?? null
  const draft = drafts[0] ?? null
  const dp = draft?.payload ?? {}
  const review = draft ? reviews
    .filter((r) => ver(r) === ver(draft) && bver(r) === bver(draft))
    .sort((a, b) => String(at(b)).localeCompare(String(at(a))))[0]?.payload ?? null : null
  const runList = runs.map((r) => r.payload ?? r).filter(Boolean).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
  const active = runList.findLast((r) => r.status === 'running') ?? null
  const last = runList.at(-1) ?? null

  // The newest run step for each stage: its run and time.
  const stepOf = {}
  for (const r of runList) {
    for (const s of r.steps ?? []) {
      const key = STEP_STAGE[s.name]
      if (key) stepOf[key] = { run_id: r.run_id, status: s.status, at: s.finished_at ?? s.started_at ?? r.started_at, summary: s.summary ?? '' }
    }
    if (r.mode === 'approve' || r.mode === 'reject_topic' || r.mode === 'human_revise') stepOf.you = { run_id: r.run_id, status: r.status, at: r.finished_at ?? r.started_at, summary: r.result_summary ?? '' }
  }
  const firstRun = runList[0] ?? null
  const status = draft?.status ?? brief?.status ?? last?.status ?? 'unknown'
  const approved = ['approved', 'published'].includes(draft?.status)
  const live = published.find((p) => p.status === 'published') ?? null
  const docstarLive = exportRec?.payload?.docstar_state === 'published'

  const s = {}
  s.topic = { state: brief || runList.length || pick ? 'done' : 'todo', detail: pick ? `Chosen this week: ${pick.pick?.title ?? ''}` : brief?.payload?.topic ?? brief?.payload?.titles?.[0] ?? '', run_id: firstRun?.run_id ?? null, at: firstRun?.started_at ?? null }
  s.research = { state: brief || stepOf.research?.status === 'succeeded' ? 'done' : 'todo', detail: stepOf.research?.summary ?? '' }
  s.plan = { state: brief ? 'done' : 'todo', detail: brief ? `Brief v${bver(brief)}${brief.payload?.keyword ? ` · ${brief.payload.keyword}` : ''}` : '' }
  s.draft = { state: draft ? 'done' : 'todo', detail: draft ? `v${ver(draft)}${dp.word_count ? ` · ${Number(dp.word_count).toLocaleString('en-US')} words` : ''}${dp.reading?.post_grade != null ? ` · grade ${dp.reading.post_grade}` : ''}` : '' }
  s.review = review
    ? { state: review.pass ? 'done' : 'failed', detail: `${review.total ?? '?'}/100 · ${review.pass ? 'pass' : 'needs work'}` }
    : { state: approved ? 'off' : 'todo', detail: approved ? 'not reviewed' : '' }
  s.you = draft?.status === 'awaiting_human' ? { state: 'waiting', detail: 'Waiting for your decision' }
    : approved ? { state: 'done', detail: draft.metadata?.approved_at ? `Approved ${String(draft.metadata.approved_at).slice(0, 16).replace('T', ' ')}` : 'Approved' }
      : ['rejected'].includes(draft?.status ?? brief?.status) ? { state: 'failed', detail: 'Topic rejected' }
        : { state: 'todo', detail: '' }
  s.export = { state: exportRec ? 'done' : 'todo', detail: exportRec?.payload?.filename ?? '' }
  s.published = target === 'none' ? { state: 'off', detail: 'Publishing is off: the Markdown export is the output' }
    : live || docstarLive || draft?.status === 'published' ? { state: 'done', detail: exportRec?.payload?.docstar_url ?? live?.payload?.url ?? live?.metadata?.slug ?? 'Live' }
      : exportRec?.payload?.docstar_state === 'draft' ? { state: 'todo', detail: 'Sent to Docstar as a draft' }
        : { state: 'todo', detail: '' }

  // A run working on this post: the first stage not yet done is the current one. A failed newest run marks it failed.
  const open = STAGES.map(([k]) => k).find((k) => ['todo', 'failed'].includes(s[k].state) && !(k === 'review' && s.you.state === 'waiting'))
  if (open && active) s[open] = { ...s[open], state: 'current' }
  else if (open && last && ['failed', 'cancelled'].includes(last.status) && s[open].state === 'todo') s[open] = { ...s[open], state: 'failed', detail: last.result_summary || last.error || `run ${last.status}` }

  return {
    title: dp.title ?? brief?.payload?.titles?.[0] ?? pick?.pick?.title ?? '',
    status,
    stages: STAGES.map(([key, label]) => ({
      id: key, label, state: s[key].state, detail: s[key].detail ?? '',
      run_id: s[key].run_id ?? stepOf[key]?.run_id ?? null, at: s[key].at ?? stepOf[key]?.at ?? null
    })),
    runs: runList.map((r) => ({ run_id: r.run_id, mode: r.mode, status: r.status, started_at: r.started_at, finished_at: r.finished_at ?? null, result_summary: r.result_summary ?? '' })).reverse(),
    active_run_id: active?.run_id ?? null
  }
}
