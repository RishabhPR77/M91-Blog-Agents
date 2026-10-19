// TEST-ONLY commands (never available through the API). They exist so the approval flow can be tested
// cheaply on an existing draft, without a full pipeline run. Off unless ALLOW_TEST_COMMANDS=true.

import { istIso } from './util/time.js'
import { loadBrief } from './writer/inputs.js'
import { loadDraft } from './reviewer/inputs.js'
import { draftVersion, draftBriefVersion, draftsOf } from './writer/save.js'

export class TestCommandError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TestCommandError'
  }
}

/**
 * npm run test:await — puts an existing draft at awaiting_human, as a Reviewer pass would, and marks the
 * draft and its brief as test data (metadata.test = true, so cleanup lists them). Refuses when
 * ALLOW_TEST_COMMANDS is false, and refuses published drafts. Any other waiting draft of the brief is superseded.
 * @returns {{ brief_id, version, brief_version, draft_id, brief_record_id, previous_status, total }}
 */
export async function setAwaitingForTest(store, config, { briefId, version, now = Date.now }) {
  if (!config.testing?.allowTestCommands) throw new TestCommandError('test commands are off: set ALLOW_TEST_COMMANDS=true in .env to use them')
  if (typeof briefId !== 'string' || !briefId.trim()) throw new TestCommandError('usage: npm run test:await -- --brief-id=<id> [--version=<n>]')
  const draft = await loadDraft(store, briefId, { version })
  if (!draft) throw new TestCommandError(`no draft of brief ${briefId}${version ? ` v${version}` : ''}`)
  const briefRec = await loadBrief(store, briefId, draftBriefVersion(draft))
  const published = draft.status === 'published' || briefRec?.status === 'published' ||
    (await store.getRecords({ type: 'published_post', brief_id: briefId })).length > 0
  if (published) throw new TestCommandError(`brief ${briefId} is published: test commands never touch published posts`)

  const at = istIso(new Date(now()))
  const v = draftVersion(draft)
  const previousStatus = draft.status
  const review = (await store.getRecords({ type: 'review', brief_id: briefId }))
    .filter((r) => Number(r.payload?.version ?? r.version) === v && Number(r.payload?.brief_version ?? r.metadata?.brief_version ?? 1) === draftBriefVersion(draft))
    .sort((a, b) => String(b.createdAt ?? b.date).localeCompare(String(a.createdAt ?? a.date)))[0]
  const total = review?.payload?.total ?? null
  for (const other of await draftsOf(store, briefId)) {
    if (other.id !== draft.id && other.status === 'awaiting_human') await store.updateRecord(other.id, undefined, { status: 'superseded' })
  }
  await store.updateRecord(draft.id, undefined, { status: 'awaiting_human', awaiting_since: at, review_total: total, test: true, test_command: 'test:await' })
  if (briefRec?.id) await store.updateRecord(briefRec.id, undefined, { status: 'awaiting_human', test: true })
  return { brief_id: briefId, version: v, brief_version: draftBriefVersion(draft), draft_id: draft.id, brief_record_id: briefRec?.id ?? null, previous_status: previousStatus, total }
}
