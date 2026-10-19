// The dashboard registers every engine event type on its EventSource (named SSE events are only delivered
// to listeners for that name), so its list must match events.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EVENT_TYPES } from '../src/events.js'

test('dashboard/src/api/sse.ts lists exactly the engine EVENT_TYPES', () => {
  const src = readFileSync(new URL('../dashboard/src/api/sse.ts', import.meta.url), 'utf8')
  const block = src.match(/export const EVENT_TYPES = \[([\s\S]*?)\] as const/)
  assert.ok(block, 'EVENT_TYPES block found')
  const listed = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual([...listed].sort(), [...EVENT_TYPES].sort())
})
