// The dashboard's low-cost switch sends dashboard/src/config/low-cost.json (with one Scout group).
// It must be exactly what configForRun accepts, and set what it says.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { configForRun } from '../src/runs.js'
import { fakeConfig } from './helpers.js'

const LOW_COST = JSON.parse(readFileSync(new URL('../dashboard/src/config/low-cost.json', import.meta.url), 'utf8'))

test('the dashboard low-cost params pass configForRun for every Scout group and apply the low-cost limits', () => {
  for (const g of [1, 2, 3, 4, 5]) {
    const params = { ...LOW_COST, scout: { ...LOW_COST.scout, question_groups: [g] } }
    const c = configForRun(fakeConfig(), { params })
    assert.deepEqual(c.scout.questionGroups, [g])
    assert.equal(c.scout.questionsPerGroup, 3)
    assert.equal(c.scout.maxCalls, 6)
    assert.equal(c.scout.docsMaxChars, 15000)
    assert.equal(c.scout.docsMaxPages, 5)
    assert.equal(c.viasocket.maxRetries, 1)
    assert.equal(c.reviewer.maxSourceChecks, 1)
    assert.equal(c.limits.maxWriterRevisions, 1)
    assert.equal(c.limits.maxAiRoundsPerPost, 2)
  }
})
