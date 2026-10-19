// Expected AI calls per action, shown next to every button and in every confirm dialog. Static estimates:
// adjust them here. "lowCost" applies when the low-cost switch is on (see low-cost.json).
export type Estimate = { normal: string; lowCost: string; note?: string }

export const COSTS = {
  full: { normal: '15–23', lowCost: '9–14', note: 'Scout + Strategist + Writer + Reviewer, plus revision rounds' },
  scout: { normal: '≈10', lowCost: '5–6' },
  strategist: { normal: '1–2', lowCost: '1–2' },
  writer: { normal: '1–2', lowCost: '1–2' },
  reviewer: { normal: '1–2', lowCost: '1–2' },
  reviewer_route: { normal: '2–10', lowCost: '2–5', note: 'Reviewer, then revision rounds until a pass or a limit' },
  promo: { normal: '1–2', lowCost: '1–2' },
  // Approval actions (Task 5): the low-cost switch does not apply to them.
  approve: { normal: '1–2', lowCost: '1–2', note: 'promo pack (1, +1 if it needs a repair)' },
  approval_review: { normal: '1–2', lowCost: '1–2' },
  human_revise_rereview: { normal: '2–4', lowCost: '2–4', note: 'Writer revision, then the Reviewer' },
  human_revise_no_rereview: { normal: '1–2', lowCost: '1–2', note: 'Writer revision only' },
  reject_topic: { normal: '0', lowCost: '0' }
} satisfies Record<string, Estimate>

export type CostKey = keyof typeof COSTS

export const expectedCalls = (key: CostKey, lowCost: boolean) => (lowCost ? COSTS[key].lowCost : COSTS[key].normal)
