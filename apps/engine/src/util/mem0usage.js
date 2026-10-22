// The Mem0 quota guard's estimate (Phase 9 A5): every counted Mem0 request is added to a small local file,
// apps/engine/data/mem0-usage.json (gitignored): requests per kind for the month, and per day. Numbers only,
// never content. The month is the UTC calendar month (Mem0's quota resets on the 1st, 00:00 UTC). The Mem0
// console has the exact figure; this is an estimate (requests made by other tools are not seen).
// Phase 12: Mem0 counts two quotas. Retrievals (reads + searches) count against MEM0_MONTHLY_LIMIT (1,000 on
// the plan) and decide the guard's level; adds (writes) have their own MEM0_MONTHLY_ADD_LIMIT (10,000).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './runlock.js'

export const USAGE_FILE = 'mem0-usage.json'
const KINDS = ['reads', 'searches', 'writes']

let target = null // { file, now }

/** Where usage is recorded (the store calls this with its config). */
export function configureUsage(config, { now = Date.now } = {}) {
  target = { file: join(dataDir(config), USAGE_FILE), now }
}

/** Tests: stop recording. */
export function resetUsageTarget() {
  target = null
}

const monthOf = (t) => new Date(t).toISOString().slice(0, 7)
const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
const blank = () => ({ reads: 0, searches: 0, writes: 0 })

function readFile(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/**
 * The file for the current month (a new month starts from zero). seed / seed_adds: the retrieval and add figures
 * set from the Mem0 console (a file from before Phase 12 has one seed: it is taken as retrievals).
 */
function current(file, t) {
  const month = monthOf(t)
  const v = readFile(file)
  if (!v || v.month !== month) return { month, seed: 0, seed_adds: 0, total: blank(), days: {} }
  return { month, seed: Number(v.seed) || 0, seed_adds: Number(v.seed_adds) || 0, total: { ...blank(), ...v.total }, days: v.days ?? {} }
}

/**
 * Sets this month's figures from the Mem0 console: n retrievals and, when given, the adds. The estimate becomes
 * those plus what is counted from now. npm run mem0:usage -- --set=<retrievals> [--set-adds=<adds>]
 * Without adds, the add figure keeps what it had (its seed plus the writes counted so far).
 */
export function setUsage(config, n, { now = Date.now, adds } = {}) {
  const whole = (x) => Number.isInteger(x) && x >= 0
  if (!whole(n)) throw new Error('the figure must be a whole number ≥ 0')
  if (adds !== undefined && !whole(adds)) throw new Error('the add figure must be a whole number ≥ 0')
  const t = now()
  const file = join(dataDir(config), USAGE_FILE)
  const v = current(file, t)
  const seedAdds = adds ?? v.seed_adds + v.total.writes
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify({ month: v.month, seed: n, seed_adds: seedAdds, total: blank(), days: v.days }))
  return usageStatus(config, { now })
}

/** Adds n requests of a kind (reads | searches | writes). Never throws. */
export function recordUsage(kind, n = 1) {
  if (!target || !KINDS.includes(kind)) return
  try {
    const t = target.now()
    const v = current(target.file, t)
    v.total[kind] += n
    const d = (v.days[dayOf(t)] ??= blank())
    d[kind] += n
    mkdirSync(join(target.file, '..'), { recursive: true })
    writeFileSync(target.file, JSON.stringify(v))
  } catch {}
}

/** The reset time: the 1st of next month, 00:00 UTC. */
export function resetsOn(t) {
  const d = new Date(t)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString()
}

/**
 * The guard's view. used / limit / pct: retrievals (reads + searches) against MEM0_MONTHLY_LIMIT; adds: writes
 * against MEM0_MONTHLY_ADD_LIMIT. level ('ok' | 'warn' | 'stop', from MEM0_WARN_PCT / MEM0_STOP_PCT) is the worse
 * of the two (limited: which quota decided it). Also the reset date, the counted totals and days.
 */
export function usageStatus(config, { now = Date.now } = {}) {
  const t = now()
  const v = current(join(dataDir(config), USAGE_FILE), t)
  const warn = config?.mem0?.warnPct ?? 80
  const stop = config?.mem0?.stopPct ?? 95
  const pctOf = (used, limit) => (limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0)
  const levelOf = (pct) => (pct >= stop ? 'stop' : pct >= warn ? 'warn' : 'ok')
  const used = v.seed + v.total.reads + v.total.searches
  const limit = config?.mem0?.monthlyLimit ?? 1000
  const pct = pctOf(used, limit)
  const addUsed = v.seed_adds + v.total.writes
  const addLimit = config?.mem0?.monthlyAddLimit ?? 10000
  const adds = { used: addUsed, limit: addLimit, pct: pctOf(addUsed, addLimit), level: levelOf(pctOf(addUsed, addLimit)) }
  const RANK = { ok: 0, warn: 1, stop: 2 }
  const own = levelOf(pct)
  const level = RANK[adds.level] > RANK[own] ? adds.level : own
  const limited = level === 'ok' ? null : RANK[adds.level] > RANK[own] ? 'adds' : 'retrievals'
  return { month: v.month, used, limit, pct, level, limited, adds, warn_pct: warn, stop_pct: stop, resets_on: resetsOn(t), seed: v.seed, seed_adds: v.seed_adds, total: v.total, days: v.days }
}

/** "Mem0 retrieval quota almost used: 960/1000. Runs paused until 1 Nov 2026 or a higher limit." */
export function stopMessage(u) {
  const date = new Date(u.resets_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (u.limited === 'adds') return `Mem0 add quota almost used: ${u.adds.used}/${u.adds.limit}. Runs paused until ${date} or a higher limit (MEM0_MONTHLY_ADD_LIMIT).`
  return `Mem0 retrieval quota almost used: ${u.used}/${u.limit}. Runs paused until ${date} or a higher limit (MEM0_MONTHLY_LIMIT).`
}

/** The warning line for a run summary at the warn level. */
export const warnLine = (u) => `Mem0 quota: ${u.used}/${u.limit} retrievals (${u.pct}%) and ${u.adds.used}/${u.adds.limit} adds this month; resets ${u.resets_on.slice(0, 10)}`
