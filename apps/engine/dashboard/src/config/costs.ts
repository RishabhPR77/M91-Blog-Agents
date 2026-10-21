// Expected AI calls per action, shown next to every button and in every confirm dialog. Static estimates:
// adjust them here. "lowCost" applies when the low-cost switch is on (see low-cost.json).
// mem0 (Phase 9): expected Mem0 requests, from the measured runs in apps/engine/docs/PHASE9_NOTES.md (A6);
// Phase 10 numbers from test/fullrun-mem0.test.js (approve 9, designer 7, human_revise 18).
// They are "cold" numbers; a run started from the dashboard reads less, since the engine's index serves the
// data it already holds. The full run's range covers 1–2 Writer revisions (MAX_WRITER_REVISIONS=2).
export type Estimate = { normal: string; lowCost: string; mem0: string; mem0LowCost?: string; note?: string }

export const COSTS = {
  full: { normal: '15–23', lowCost: '9–14', mem0: '≈28–45', mem0LowCost: '≈25–35', note: 'Scout + Strategist + Writer + Reviewer, plus revision rounds' },
  scout: { normal: '≈10', lowCost: '5–6', mem0: '≈10–15', mem0LowCost: '≈8–11' },
  strategist: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  writer: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  reviewer: { normal: '1–2', lowCost: '1–2', mem0: '≈2–5' },
  reviewer_route: { normal: '2–10', lowCost: '2–5', mem0: '≈10–25', note: 'Reviewer, then revision rounds until a pass or a limit' },
  promo: { normal: '1–2', lowCost: '1–2', mem0: '≈3–5' },
  // Approval actions (Task 5): the low-cost switch does not apply to them.
  // Phase 10: the guide is built before the review, and the promo pack is off (PROMO_ENABLED=false): no AI.
  approve: { normal: '0', lowCost: '0', mem0: '≈9', note: 'no AI: the guide was built before the review; the promo pack is off' },
  approve_promo: { normal: '1–2', lowCost: '1–2', mem0: '≈11–14', note: 'promo pack (1, +1 if it needs a repair): PROMO_ENABLED=true' },
  designer: { normal: '1–2', lowCost: '1–2', mem0: '≈7', note: 'Experience Designer (1, +1 if it needs a repair)' },
  approval_review: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  // C5: "Change the writing" (Writer, then the Experience Designer) or "Change the design" (Experience Designer only).
  human_revise_rereview: { normal: '3–6', lowCost: '3–6', mem0: '≈18', note: 'Writer revision, the Experience Designer, then the Reviewer' },
  human_revise_no_rereview: { normal: '2–4', lowCost: '2–4', mem0: '≈10–14', note: 'Writer revision and the Experience Designer' },
  human_design_rereview: { normal: '2–4', lowCost: '2–4', mem0: '≈10–14', note: 'the Experience Designer, then the Reviewer' },
  human_design_no_rereview: { normal: '1–2', lowCost: '1–2', mem0: '≈7', note: 'the Experience Designer only' },
  reject_topic: { normal: '0', lowCost: '0', mem0: '≈4–6' },
  // Phase 7: the Publisher is code, not AI.
  publish: { normal: '0', lowCost: '0', mem0: '≈13', note: 'no AI: build, deploy and check' },
  rebuild_blog: { normal: '0', lowCost: '0', mem0: '≈6', note: 'no AI: rebuild and redeploy the blog' },
  unpublish: { normal: '0', lowCost: '0', mem0: '≈10', note: 'no AI: rebuild without the post and deploy' },
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
