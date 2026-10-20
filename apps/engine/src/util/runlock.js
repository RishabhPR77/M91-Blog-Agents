// The run lock (Phase 9): a local file, so taking and releasing it costs no Mem0 requests. It is created
// atomically (fails if it exists) and holds the pid, the run id and a heartbeat time that is refreshed while
// the run is active. A lock whose process is gone, or whose heartbeat is older than RUN_LOCK_STALE_MIN, is
// taken over with a warning. Only one machine can share it (the engine and the CLI on this computer).
import { mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.js'

const DEFAULT_DIR = fileURLToPath(new URL('../../data/', import.meta.url))
export const LOCK_FILE = 'run.lock'
export const HEARTBEAT_MS = 30 * 1000

/** apps/engine/data, or ENGINE_DATA_DIR. */
export const dataDir = (config) => config?.runtime?.dataDir || DEFAULT_DIR

export class LockedError extends Error {
  constructor(message = 'A pipeline run is already in progress') {
    super(message)
    this.name = 'LockedError'
  }
}

/** Whether a process with this pid is running (EPERM: it exists, we just may not signal it). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Takes the run lock or throws LockedError ("A pipeline run is already in progress (owner <run id>)").
 * Returns { file, release() }; release is safe to call twice and removes the file only while it is ours.
 * deps (tests): now, pid, isAlive, heartbeatMs.
 */
export function acquireRunLock({ owner, config, now = Date.now, pid = process.pid, isAlive = pidAlive, heartbeatMs = HEARTBEAT_MS } = {}) {
  const dir = dataDir(config)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, LOCK_FILE)
  const staleMs = (config?.runtime?.runLockStaleMin ?? 10) * 60 * 1000
  const body = () => JSON.stringify({ pid, run_id: owner, acquired_at: acquiredAt, heartbeat_at: new Date(now()).toISOString() })
  const acquiredAt = new Date(now()).toISOString()

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      writeSync(fd, body())
      closeSync(fd)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const held = readLock(file)
      const beat = Date.parse(held?.heartbeat_at)
      const stale = !held || !isAlive(held.pid) || !(beat > 0) || now() - beat > staleMs
      if (!stale || attempt === 1) throw new LockedError(`A pipeline run is already in progress (owner ${held?.run_id ?? 'unknown'})`)
      log.warn('taking over a stale run lock', { run_id: held?.run_id ?? null, pid: held?.pid ?? null, heartbeat_at: held?.heartbeat_at ?? null })
      try {
        unlinkSync(file)
      } catch {}
    }
  }

  const mine = () => readLock(file)?.run_id === owner && readLock(file)?.pid === pid
  const timer = setInterval(() => {
    try {
      if (mine()) writeFileSync(file, body())
    } catch (error) {
      log.warn('run lock heartbeat failed', { error })
    }
  }, heartbeatMs)
  timer.unref?.()
  let released = false
  return {
    file,
    async release() {
      if (released) return
      released = true
      clearInterval(timer)
      try {
        if (mine()) unlinkSync(file)
      } catch (error) {
        log.warn('could not remove the run lock file', { error })
      }
    }
  }
}
