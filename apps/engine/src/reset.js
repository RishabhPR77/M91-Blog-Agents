// A fresh start (Phase 12, Task 1): `npm run reset:all`. It removes every Mem0 memory under this engine's
// MEM0_AGENT_ID and the local leftovers (the exports folder, the engine's data folder except the Mem0 usage
// file). It never touches another agent id, user, app or project, and it keeps data/mem0-usage.json: deleting
// memories does not give back the month's quota.
//   --dry-run   one paged list of our agent's memories, counted by type; the leftovers; nothing changes
//   (no flag)   the same list, then "yes" typed by the person, then one delete-all for our agent id, a check
//               list, and the local clean-up. The write marker is stamped, so a running engine says its data
//               may be out of date (Refresh from Mem0 reloads its index, now empty).

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, LOCK_FILE, pidAlive } from './util/runlock.js'
import { exportDir } from './export/index.js'
import { markWrite } from './storeevents.js'

/** Files in data/ that a reset keeps. */
export const KEEP_IN_DATA = Object.freeze(['mem0-usage.json'])

export class ResetError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ResetError'
  }
}

const countFiles = (dir) => {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).reduce((n, f) => n + (statSync(join(dir, f)).isDirectory() ? countFiles(join(dir, f)) : 1), 0)
}

/** What a reset would remove locally: { exports: { dir, files }, data: { dir, entries: [{ name, files }] } }. */
export function localLeftovers(config) {
  const ex = exportDir(config)
  const dd = dataDir(config)
  const entries = existsSync(dd)
    ? readdirSync(dd).filter((f) => !KEEP_IN_DATA.includes(f)).map((name) => ({ name, files: statSync(join(dd, name)).isDirectory() ? countFiles(join(dd, name)) : 1 }))
    : []
  return { exports: { dir: ex, files: countFiles(ex) }, data: { dir: dd, entries, kept: KEEP_IN_DATA.filter((f) => existsSync(join(dd, f))) } }
}

/** Counts memories by metadata.type ("(no type)" for memories without one). */
export function countByType(memories) {
  const out = {}
  for (const m of memories) {
    const t = m?.metadata?.type ?? '(no type)'
    out[t] = (out[t] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

/** A run in progress (a live lock) blocks a reset. */
export function activeLock(config) {
  const file = join(dataDir(config), LOCK_FILE)
  if (!existsSync(file)) return null
  try {
    const lock = JSON.parse(readFileSync(file, 'utf8'))
    return pidAlive(lock.pid) ? lock : null
  } catch {
    return null
  }
}

/** The dry run: { agent_id, total, byType, local } — one paged list, no change. */
export async function planReset({ store, config }) {
  if (!store.agentId || /[*]/.test(store.agentId)) throw new ResetError(`refusing to list: MEM0_AGENT_ID "${store.agentId ?? ''}" is empty or a wildcard`)
  const memories = await store.listAgentMemories()
  return { agent_id: store.agentId, total: memories.length, byType: countByType(memories), local: localLeftovers(config) }
}

/**
 * The real reset. confirm(plan) must resolve true (the CLI asks for "yes"); otherwise nothing changes.
 * @returns {{ done: boolean, plan, deleted?: number, left?: number, removedLocal?: string[] }}
 */
export async function runReset({ store, config, confirm }) {
  if (store.dryRun) throw new ResetError('the store is in DRY_RUN mode: a reset needs a real store')
  if (!store.agentId || /[*]/.test(store.agentId)) throw new ResetError(`refusing to reset: MEM0_AGENT_ID "${store.agentId ?? ''}" is empty or a wildcard`)
  const lock = activeLock(config)
  if (lock) throw new ResetError(`a run is in progress (${lock.run_id ?? 'unknown run'}): reset when it has finished`)
  const plan = await planReset({ store, config })
  if (!(await confirm(plan))) return { done: false, plan }
  let deleted = 0
  if (plan.total > 0) {
    await store.deleteAllForAgent()
    deleted = plan.total
  }
  const left = plan.total > 0 ? (await store.listAgentMemories()).length : 0
  // Local leftovers: the exports folder and data/ except the usage file.
  const removedLocal = []
  if (existsSync(plan.local.exports.dir)) {
    for (const f of readdirSync(plan.local.exports.dir)) {
      rmSync(join(plan.local.exports.dir, f), { recursive: true, force: true })
      removedLocal.push(`exports/${f}`)
    }
  }
  for (const e of plan.local.data.entries) {
    rmSync(join(plan.local.data.dir, e.name), { recursive: true, force: true })
    removedLocal.push(`data/${e.name}`)
  }
  // A running engine learns that the data changed (its index reports "may be out of date").
  markWrite(config)
  return { done: true, plan, deleted, left, removedLocal }
}

/** Plain lines for the CLI. */
export function planLines(plan) {
  const lines = [`Mem0 memories under agent id "${plan.agent_id}": ${plan.total}`]
  for (const [t, n] of Object.entries(plan.byType)) lines.push(`  ${String(n).padStart(4)}  ${t}`)
  lines.push(`Local: ${plan.local.exports.files} file(s) in ${plan.local.exports.dir}`)
  lines.push(`       ${plan.local.data.entries.length ? plan.local.data.entries.map((e) => `${e.name} (${e.files})`).join(', ') : 'nothing'} in ${plan.local.data.dir}`)
  lines.push(`Kept:  ${plan.local.data.kept.join(', ') || 'nothing'} (the month's Mem0 quota is not given back by deleting)`)
  return lines
}
