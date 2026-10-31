// PUBLISH_TARGET=slack: an approved post goes to Slack as one message through the blog-slack-post flow: its title,
// score and size, why it was written this week, and links to download its Markdown file and to open its post page on
// the engine (ENGINE_PUBLIC_URL; both ask for the dashboard login first). viaSocket's Slack app cannot attach a file
// yet, so the .md is a download link.
// VIASOCKET-PENDING: a Slack "upload file" action (reported to viaSocket as missing) would attach the .md itself.

/** The message text. */
export function slackPostText({ title, briefId, publicUrl, filename, total = null, words = null, grade = null, reason = null, auto = false, bestOfFailed = null }) {
  const head = auto ? (bestOfFailed ? '📄 New post (sent automatically, best version)' : '📄 New post (approved automatically)') : '📄 New post (approved)'
  const facts = [total != null ? `AI review ${total}/100` : null, words ? `${Number(words).toLocaleString('en-US')} words` : null, grade != null ? `reading grade ${grade}` : null].filter(Boolean).join(' · ')
  return [
    `${head}: *${title}*`,
    facts,
    bestOfFailed ? `⚠️ The AI review did not pass any of ${bestOfFailed.reviews} versions; this is the best one (v${bestOfFailed.version}, ${bestOfFailed.total}/100). Read it before you publish it.` : null,
    reason ? `Why this week: ${reason}` : null,
    `Download the Markdown (${filename}): ${publicUrl}/api/exports/${briefId}/download`,
    `Open the post: ${publicUrl}/approvals/${briefId}`
  ].filter(Boolean).join('\n')
}

/**
 * Posts the message for a brief's final export. Returns a run result ({ status, summary, warnings }).
 * meta: { title, total, words, grade, reason, auto, bestOfFailed } (anything missing is left out of the message).
 * With a store, the export record keeps when it was sent (slack_sent_at; the post's journey shows it).
 */
export async function publishToSlack({ notifier, config, exportRecord, briefId, meta = {}, store = null, now = Date.now }) {
  if (!exportRecord) return { status: 'no_export', summary: 'no final Markdown export for this brief: approve it first', warnings: ['no final Markdown export'] }
  const p = exportRecord.payload
  const text = slackPostText({ ...meta, title: meta.title ?? p.title, briefId, publicUrl: config.runtime.publicUrl, filename: p.filename })
  const out = await notifier.slack(text)
  if (out?.skipped === 'pending_flows') return { status: 'skipped', summary: 'Not sent to Slack: SLACK_POST_WEBHOOK_URL is empty', warnings: ['Slack flow URL not set'] }
  if (out?.dryRun) return { status: 'dry_run', summary: `DRY_RUN: the Slack message for ${p.filename} was not sent`, warnings: [] }
  if (store) await store.updateRecord(exportRecord.id, { ...p, slack_sent_at: new Date(now()).toISOString() }, {}, { known: exportRecord })
  return { status: 'sent', summary: `Sent to Slack with the download link: ${p.filename}`, warnings: [] }
}
