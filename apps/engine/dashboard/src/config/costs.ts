// Expected AI calls per action, shown next to every button and in every confirm dialog. Static estimates:
// adjust them here. "lowCost" applies when the low-cost switch is on (see low-cost.json).
// mem0 (Phase 9): expected Mem0 requests, from the measured runs in apps/engine/docs/PHASE9_NOTES.md (A6);
// Phase 10 numbers from test/fullrun-mem0.test.js (approve 9, designer 7, human_revise 18).
// Phase 11 (EXPERIENCE_ENABLED=false): the *_plain keys are the same runs without the Experience Designer (1–2 AI
// calls and one guide_doc write less per draft version); approving also saves the Markdown export (approve 12).
// They are "cold" numbers; a run started from the dashboard reads less, since the engine's index serves the
// data it already holds. The full run's range covers 1–2 Writer revisions (MAX_WRITER_REVISIONS=2).
export type Estimate = { normal: string; lowCost: string; mem0: string; mem0LowCost?: string; note?: string }

export const COSTS = {
  // The weekly run: news check (1) + this week's questions (1) + the editor (1) + the focused Scout (2–3) + Strategist
  // + Writer + Experience Designer (1–2 per draft) + Reviewer, plus revision rounds. Memory: test/fullrun-mem0.test.js.
  full: { normal: '10–22', lowCost: '10–22', mem0: '≈33–50', note: 'news check, this week\'s questions, the editor\'s pick, focused Scout, Strategist, Writer, Experience Designer and Reviewer, plus revision rounds' },
  // The news check (1 call; memory: ≈2–3 retrievals, plus one add per new card). A full run makes it first.
  timely_check: { normal: '1', lowCost: '1', mem0: '≈2–3', note: 'one web search for fresh events; +1 add per new card; it writes nothing' },
  // The published guides on msg91.com/guide: no AI; one Mem0 add per new guide (and one list read).
  guides: { normal: '0', lowCost: '0', mem0: '≈1–3', note: 'reads msg91.com/guide, saves each new M91 guide' },
  full_plain: { normal: '9–19', lowCost: '9–19', mem0: '≈31–45', note: 'news check, this week\'s questions, the editor\'s pick, focused Scout, Strategist, Writer and Reviewer, plus revision rounds (no Experience Designer)' },
  scout: { normal: '≈10', lowCost: '5–6', mem0: '≈10–15', mem0LowCost: '≈8–11' },
  strategist: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  writer: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  reviewer: { normal: '1–2', lowCost: '1–2', mem0: '≈2–5' },
  reviewer_route: { normal: '2–14', lowCost: '2–7', mem0: '≈10–28', note: 'Reviewer, then revision rounds (Writer, Experience Designer, Reviewer) until a pass or a limit' },
  reviewer_route_plain: { normal: '2–11', lowCost: '2–5', mem0: '≈10–25', note: 'Reviewer, then revision rounds (Writer, Reviewer) until a pass or a limit' },
  promo: { normal: '1–2', lowCost: '1–2', mem0: '≈3–5' },
  // Approval actions (Task 5): the low-cost switch does not apply to them.
  // Phase 10: the guide is built before the review, and the promo pack is off (PROMO_ENABLED=false): no AI.
  approve: { normal: '0', lowCost: '0', mem0: '≈12', note: 'no AI: saves the final Markdown export; the guide (if any) was built before the review; the promo pack is off' },
  approve_promo: { normal: '1–2', lowCost: '1–2', mem0: '≈14–17', note: 'promo pack (1, +1 if it needs a repair): PROMO_ENABLED=true' },
  designer: { normal: '1–2', lowCost: '1–2', mem0: '≈7', note: 'Experience Designer (1, +1 if it needs a repair)' },
  approval_review: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  // C5: "Change the writing" (Writer, then the Experience Designer) or "Change the design" (Experience Designer only).
  human_revise_rereview: { normal: '3–6', lowCost: '3–6', mem0: '≈18', note: 'Writer revision, the Experience Designer, then the Reviewer' },
  human_revise_no_rereview: { normal: '2–4', lowCost: '2–4', mem0: '≈10–14', note: 'Writer revision and the Experience Designer' },
  human_design_rereview: { normal: '2–4', lowCost: '2–4', mem0: '≈10–14', note: 'the Experience Designer, then the Reviewer' },
  human_design_no_rereview: { normal: '1–2', lowCost: '1–2', mem0: '≈7', note: 'the Experience Designer only' },
  human_revise_rereview_plain: { normal: '2–4', lowCost: '2–4', mem0: '≈17', note: 'Writer revision, then the Reviewer' },
  human_revise_no_rereview_plain: { normal: '1–2', lowCost: '1–2', mem0: '≈9–13', note: 'Writer revision only' },
  reject_topic: { normal: '0', lowCost: '0', mem0: '≈4–6' },
  // Phase 7: the Publisher is code, not AI.
  publish: { normal: '0', lowCost: '0', mem0: '≈13', note: 'no AI: build, deploy and check' },
  rebuild_blog: { normal: '0', lowCost: '0', mem0: '≈6', note: 'no AI: rebuild and redeploy the blog' },
  unpublish: { normal: '0', lowCost: '0', mem0: '≈10', note: 'no AI: rebuild without the post and deploy' },
  // Phase 11: the Markdown export is code too (export_save: the final export, record and file).
  export: { normal: '0', lowCost: '0', mem0: '≈0–4', note: 'no AI: builds the Markdown file; nothing saved' },
  export_save: { normal: '0', lowCost: '0', mem0: '≈4–6', note: 'no AI: the final export (Mem0 record and file)' },
  set_index: { normal: '0', lowCost: '0', mem0: '≈10', note: 'no AI: switch noindex, rebuild and deploy' }
} satisfies Record<string, Estimate>

export type CostKey = keyof typeof COSTS

export const expectedCalls = (key: CostKey, lowCost: boolean) => (lowCost ? COSTS[key].lowCost : COSTS[key].normal)

/** Expected Mem0 requests for the chosen preset. */
export const expectedMem0 = (key: CostKey, lowCost: boolean): string => {
  const e: Estimate = COSTS[key]
  return lowCost ? e.mem0LowCost ?? e.mem0 : e.mem0
}

/** Phase 9 C1: the two run presets on the Control page. */
export const PRESETS = {
  normal: { label: 'Normal run', text: 'Full research and up to 2 Writer revisions (MAX_WRITER_REVISIONS).' },
  lowcost: { label: 'Low-cost test run', text: 'Scout: 1 question group, 3 questions, max 6 calls, smaller docs · 1 AI retry · 1 source check · 1 Writer revision · 2 AI rounds per post.' }
} as const
export type Preset = keyof typeof PRESETS
