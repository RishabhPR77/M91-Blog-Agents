// PUBLISH_TARGET=email: an approved post is mailed to MAIL_TO through the blog-mail-post flow (Gmail): its title, score
// and size, why it was written this week, links to the post page and the dashboard download, and its Markdown file
// attached. The attachment is a signed link (src/util/filelink.js) that Gmail fetches while sending.
import { signedFilePath } from '../util/filelink.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** The email: { subject, html }. */
export function postEmail({ title, briefId, publicUrl, filename, total = null, words = null, grade = null, reason = null, auto = false, bestOfFailed = null, attached = true }) {
  const facts = [total != null ? `AI review ${total}/100` : null, words ? `${Number(words).toLocaleString('en-US')} words` : null, grade != null ? `reading grade ${grade}` : null].filter(Boolean).join(' · ')
  const how = auto ? (bestOfFailed ? 'sent automatically, best version' : 'approved automatically') : 'approved'
  const subject = `New M91 post${bestOfFailed ? ' (best version, the AI review did not pass)' : ''}: ${title}`
  const html = [
    `<p><b>${esc(title)}</b> <span style="color:#64748b">(${how})</span></p>`,
    facts ? `<p>${esc(facts)}</p>` : '',
    bestOfFailed ? `<p style="color:#b45309">The AI review did not pass any of ${bestOfFailed.reviews} versions; this is the best one (v${bestOfFailed.version}, ${bestOfFailed.total}/100). Read it before you publish it.</p>` : '',
    reason ? `<p><b>Why this week:</b> ${esc(reason)}</p>` : '',
    attached ? `<p>The Markdown file is attached: <b>${esc(filename)}</b>.</p>` : `<p>The Markdown file could not be attached; download it from the dashboard.</p>`,
    `<p><a href="${esc(`${publicUrl}/approvals/${briefId}`)}">Open the post</a> · <a href="${esc(`${publicUrl}/api/exports/${briefId}/download`)}">Download the .md</a> (both ask for the dashboard login)</p>`
  ].filter(Boolean).join('\n')
  return { subject, html }
}

/**
 * Mails a brief's final export. Returns a run result ({ status, summary, warnings }).
 * With a store, the export record keeps when it was mailed (email_sent_at; the post's journey shows it).
 */
export async function publishByEmail({ notifier, config, exportRecord, briefId, meta = {}, store = null, now = Date.now }) {
  if (!exportRecord) return { status: 'no_export', summary: 'no final Markdown export for this brief: approve it first', warnings: ['no final Markdown export'] }
  const to = config.notify.mailTo ?? []
  if (!to.length) return { status: 'skipped', summary: 'Not emailed: MAIL_TO is empty', warnings: ['MAIL_TO is empty: set the address(es) to mail approved posts to'] }
  const p = exportRecord.payload
  const path = signedFilePath({ briefId, filename: p.filename, secret: config.notify.sharedKey, days: config.notify.fileLinkDays ?? 7, now })
  const warnings = path ? [] : ['no attachment: WEBHOOK_SHARED_KEY is not set, so the file link cannot be signed']
  const { subject, html } = postEmail({ ...meta, title: meta.title ?? p.title, briefId, publicUrl: config.runtime.publicUrl, filename: p.filename, attached: Boolean(path) })
  const out = await notifier.mail({ to, subject, html, attachment_url: path ? `${config.runtime.publicUrl}${path}` : null, filename: p.filename })
  if (out?.skipped === 'pending_flows') return { status: 'skipped', summary: 'Not emailed: MAIL_POST_WEBHOOK_URL is empty', warnings: ['the mail flow URL (MAIL_POST_WEBHOOK_URL) is not set'] }
  if (out?.dryRun) return { status: 'dry_run', summary: `DRY_RUN: the email for ${p.filename} was not sent`, warnings }
  if (store) await store.updateRecord(exportRecord.id, { ...p, email_sent_at: new Date(now()).toISOString() }, {}, { known: exportRecord })
  return { status: 'sent', summary: `Emailed to ${to.length} address${to.length === 1 ? '' : 'es'} with ${p.filename}${path ? ' attached' : ''}`, warnings }
}
