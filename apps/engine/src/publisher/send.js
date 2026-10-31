// Sending an approved post to its destination when PUBLISH_TARGET is slack (a message with a download link) or email
// (a mail with the .md attached): the same facts for both, used by the approve step and the "publish" run mode.
import { latestExport } from '../export/index.js'
import { pickOfBrief } from '../weekly/editor.js'
import { publishToSlack } from './slack.js'
import { publishByEmail } from './email.js'

export const MESSAGE_TARGETS = Object.freeze(['slack', 'email'])

/** What the message says about the post: title, score, size, why this week, who approved, best of the rejected. */
export async function postMeta(store, briefId, { draft, brief = null, title = null, total = null, bestOfFailed = null } = {}) {
  const pick = await pickOfBrief(store, briefId).catch(() => null)
  return {
    title: title ?? draft?.payload?.title ?? null,
    total: total ?? draft?.metadata?.review_total ?? null,
    words: draft?.payload?.word_count ?? null,
    grade: draft?.payload?.reading?.post_grade ?? null,
    reason: pick?.reason ?? brief?.why_today ?? null,
    auto: draft?.metadata?.approved_by === 'auto',
    bestOfFailed
  }
}

/** Sends the post's final export to PUBLISH_TARGET (slack or email). Returns a run result. */
export async function sendPost({ target, notifier, config, store, briefId, meta, now = Date.now }) {
  const exportRecord = await latestExport(store, briefId)
  const args = { notifier, config, briefId, exportRecord, meta, store, now }
  return target === 'email' ? publishByEmail(args) : publishToSlack(args)
}
