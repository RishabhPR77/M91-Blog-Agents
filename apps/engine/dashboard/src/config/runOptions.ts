// The one-run params the Control page sends. low-cost.json holds exactly the params the engine's
// configForRun accepts (apps/engine/src/runs.js); a node test runs it through configForRun.
import LOW_COST from './low-cost.json'

export const TOPIC_GROUPS = [1, 2, 3, 4, 5] as const

export type LowCostParams = typeof LOW_COST

/** The low-cost params with one Scout question group. */
export function lowCostParams(group: number): LowCostParams {
  if (!TOPIC_GROUPS.includes(group as (typeof TOPIC_GROUPS)[number])) throw new Error(`question group must be 1–5 (got ${group})`)
  return { ...LOW_COST, scout: { ...LOW_COST.scout, question_groups: [group] } }
}

/** The topic group used least by recent briefs (ties → the lowest number). Groups may come back as strings. */
export function leastUsedGroup(briefGroups: unknown[]): number {
  const counts = new Map<number, number>(TOPIC_GROUPS.map((g) => [g, 0]))
  for (const g of briefGroups) {
    const n = Number(g)
    if (counts.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0]
}

export type RunRequest = { mode: string; dry_run: boolean; params: Record<string, unknown> }

/** The POST /api/runs body: the mode's own params, plus the low-cost params when the switch is on. */
export function buildRunRequest(mode: string, { dryRun, lowCost, group, params = {} }: { dryRun: boolean; lowCost: boolean; group: number; params?: Record<string, unknown> }): RunRequest {
  return { mode, dry_run: dryRun, params: { ...(lowCost ? lowCostParams(group) : {}), ...params } }
}
