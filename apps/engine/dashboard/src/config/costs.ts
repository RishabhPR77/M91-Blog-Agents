// Expected AI calls per action, shown next to every button and in every confirm dialog. Static estimates:
// adjust them here. "lowCost" applies when the low-cost switch is on (see low-cost.json).
// mem0 (Phase 9): expected Mem0 requests, from the measured runs in apps/engine/docs/PHASE9_NOTES.md (A6).
// They are "cold" numbers; a run started from the dashboard reads less, since the engine's index serves the
// data it already holds. The full run's range covers 1–2 Writer revisions (MAX_WRITER_REVISIONS=2).
export type Estimate = { normal: string; lowCost: string; mem0: string; note?: string }

export const COSTS = {
  full: { normal: '15–23', lowCost: '9–14', mem0: '≈28–45', note: 'Scout + Strategist + Writer + Reviewer, plus revision rounds' },
  scout: { normal: '≈10', lowCost: '5–6', mem0: '≈10–15' },
  strategist: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  writer: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  reviewer: { normal: '1–2', lowCost: '1–2', mem0: '≈2–5' },
  reviewer_route: { normal: '2–10', lowCost: '2–5', mem0: '≈10–25', note: 'Reviewer, then revision rounds until a pass or a limit' },
  promo: { normal: '1–2', lowCost: '1–2', mem0: '≈3–5' },
  // Approval actions (Task 5): the low-cost switch does not apply to them.
  approve: { normal: '1–2', lowCost: '1–2', mem0: '≈11', note: 'promo pack (1, +1 if it needs a repair)' },
  // Phase 8: with interactive blocks on, approving also runs the Designer.
  approve_interactive: { normal: '2–4', lowCost: '2–4', mem0: '≈11–14', note: 'promo pack (1–2) + Designer (1–2)' },
  designer: { normal: '1–2', lowCost: '1–2', mem0: '≈6', note: 'Designer plan (1, +1 if it needs a repair)' },
  approval_review: { normal: '1–2', lowCost: '1–2', mem0: '≈5–8' },
  human_revise_rereview: { normal: '2–4', lowCost: '2–4', mem0: '≈17', note: 'Writer revision, then the Reviewer' },
  human_revise_no_rereview: { normal: '1–2', lowCost: '1–2', mem0: '≈10', note: 'Writer revision only' },
  reject_topic: { normal: '0', lowCost: '0', mem0: '≈4–6' },
  // Phase 7: the Publisher is code, not AI.
  publish: { normal: '0', lowCost: '0', mem0: '≈13', note: 'no AI: build, deploy and check' },
  rebuild_blog: { normal: '0', lowCost: '0', mem0: '≈6', note: 'no AI: rebuild and redeploy the blog' },
  unpublish: { normal: '0', lowCost: '0', mem0: '≈10', note: 'no AI: rebuild without the post and deploy' },
  set_index: { normal: '0', lowCost: '0', mem0: '≈10', note: 'no AI: switch noindex, rebuild and deploy' }
} satisfies Record<string, Estimate>

export type CostKey = keyof typeof COSTS

export const expectedCalls = (key: CostKey, lowCost: boolean) => (lowCost ? COSTS[key].lowCost : COSTS[key].normal)
