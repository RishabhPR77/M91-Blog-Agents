// Ranking of open clusters (brief 11.7). Pure functions. The Scout only ranks; the Strategist chooses.

const DEMAND = { high: 3, medium: 2, low: 1 }
const FRESH = { this_week: 2, ongoing: 1 }

/** rank_score = 2 × m91_fit.score + demand + freshness − (update_candidate ? 1 : 0) */
export function rankScore(cluster) {
  return 2 * (cluster.m91_fit?.score ?? 0) + (DEMAND[cluster.demand?.level] ?? 0) + (FRESH[cluster.freshness] ?? 0) - (cluster.update_candidate ? 1 : 0)
}

/**
 * Sorts clusters by rank_score (high first). Ties: the topic group used least in `recentGroups`
 * (topic groups of the last 10 briefs, newest first), then the original order.
 * @returns clusters with `rank_score` set, sorted.
 */
export function rankClusters(clusters, recentGroups = []) {
  const usage = new Map()
  for (const g of recentGroups.slice(0, 10)) usage.set(Number(g), (usage.get(Number(g)) ?? 0) + 1)
  return clusters
    .map((c, i) => ({ c: { ...c, rank_score: rankScore(c) }, i }))
    .sort((a, b) =>
      b.c.rank_score - a.c.rank_score ||
      (usage.get(Number(a.c.topic_group)) ?? 0) - (usage.get(Number(b.c.topic_group)) ?? 0) ||
      a.i - b.i)
    .map(({ c }) => c)
}
