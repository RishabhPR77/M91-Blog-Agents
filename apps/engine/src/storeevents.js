// Store writes as in-process events (Phase 9 A4), so the engine's index follows every write this process
// makes (runs, the API) without reading Mem0 again. Every saved write also stamps a small marker file
// (pid and time only) in the engine's data folder: the engine compares it with its own pid to see that
// another process (a CLI command) changed Mem0, and the dashboard then offers a refresh.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './util/runlock.js'

const listeners = new Set()
export const WRITE_MARKER = 'last-write.json'

/** fn({ key, op: 'create'|'update'|'delete'|'lesson', record?, id?, type? }); returns an unsubscribe function. */
export function onStoreWrite(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitStoreWrite(event) {
  for (const fn of listeners) {
    try {
      fn(event)
    } catch {}
  }
}

/** Stamps the write marker (numbers only). Never fails a write. */
export function markWrite(config, { pid = process.pid, now = Date.now } = {}) {
  try {
    const dir = dataDir(config)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, WRITE_MARKER), JSON.stringify({ pid, at: now() }))
  } catch {}
}

/** The last write marker ({ pid, at }) or null. */
export function readWriteMarker(config) {
  try {
    return JSON.parse(readFileSync(join(dataDir(config), WRITE_MARKER), 'utf8'))
  } catch {
    return null
  }
}
