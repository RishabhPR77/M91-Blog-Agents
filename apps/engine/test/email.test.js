// PUBLISH_TARGET=email: each approved post is mailed to MAIL_TO through the blog-mail-post flow with its .md attached
// (a signed link Gmail fetches without the login, valid FILE_LINK_DAYS days). Fakes only: no AI, no Mem0, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { createNotifier } from '../src/notify.js'
import { signedFilePath, checkFilePath, fileLinkSecret } from '../src/util/filelink.js'
import { postEmail } from '../src/publisher/email.js'
import { buildJourney } from '../src/journey.js'
import { fakeConfig, fakeFetch } from './helpers.js'
import { config } from './writer/fixtures.js'
import { fullRun } from './fixtures/autorun.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const NOW = Date.parse('2026-10-31T06:00:00Z')
const PUBLIC = 'https://m91-engine.embarko.app'
const cfg = (env = {}) => config({ AUTO_APPROVE: 'true', APPROVE_BEST_ON_FAIL: 'true', PUBLISH_TARGET: 'email', MAIL_TO: 'me@example.com', DRY_RUN: 'false', EXPERIENCE_ENABLED: 'false', ENGINE_PUBLIC_URL: PUBLIC, ...env })
const byType = (store, type) => [...store.records.values()].filter((r) => r.type === type)

test('signed file links: valid until they expire, for that brief and file only', () => {
  const secret = 'shared-key-for-tests-0123'
  const path = signedFilePath({ briefId: '261031-1000-ABCD', filename: 'post.md', secret, days: 7, now: () => NOW })
  assert.match(path, /^\/files\/exports\/261031-1000-ABCD\/\d{10}\/[a-f0-9]{32}\/post\.md$/)
  assert.deepEqual(checkFilePath(path, { secret, now: () => NOW + 6 * 86400000 }), { ok: true, briefId: '261031-1000-ABCD', filename: 'post.md' })
  assert.equal(checkFilePath(path, { secret, now: () => NOW + 8 * 86400000 }).why, 'expired')
  assert.equal(checkFilePath(path.replace('261031-1000-ABCD', '261031-1000-WXYZ'), { secret, now: () => NOW }).why, 'bad_signature')
  assert.equal(checkFilePath(path, { secret: 'another-key', now: () => NOW }).why, 'bad_signature')
  assert.equal(signedFilePath({ briefId: 'x', filename: 'x.md', secret: '' }), null, 'no secret, no link')
  // A far expiry (more than MAX_LINK_DAYS ahead) was never made here, even with a valid signature for it.
  const far = signedFilePath({ briefId: '261031-1000-ABCD', filename: 'post.md', secret, days: 30, now: () => NOW + 400 * 86400000 })
  assert.equal(checkFilePath(far, { secret, now: () => NOW }).why, 'bad_signature')
  assert.equal(checkFilePath(signedFilePath({ briefId: 'b', filename: 'b.md', secret, days: 365, now: () => NOW }), { secret, now: () => NOW + 31 * 86400000 }).why, 'expired', 'days is capped at 30')
})

test('file links are signed with the trigger key, which never leaves the engine; the webhook key is the fallback', () => {
  assert.equal(fileLinkSecret({ runtime: { triggerKey: 'trigger-key-0123456789' }, notify: { sharedKey: 'shared-key-0123456789' } }), 'trigger-key-0123456789')
  assert.equal(fileLinkSecret({ runtime: {}, notify: { sharedKey: 'shared-key-0123456789' } }), 'shared-key-0123456789')
  assert.equal(fileLinkSecret({}), null)
})

test('the email: subject, facts, why, the best-version warning, links; HTML is escaped', () => {
  const e = postEmail({ title: 'Ask <first>', briefId: '261031-1000-ABCD', publicUrl: 'https://m91-engine.embarko.app', filename: 'ask-first.md', total: 74, words: 1300, grade: 7.2, reason: 'People asked & cared', auto: true, bestOfFailed: { version: 2, total: 74, reviews: 3 } })
  assert.equal(e.subject, 'New M91 post (best version, the AI review did not pass): Ask <first>')
  assert.match(e.html, /<b>Ask &lt;first&gt;<\/b> <span style="color:#64748b">\(sent automatically, best version\)<\/span>/)
  assert.match(e.html, /AI review 74\/100 · 1,300 words · reading grade 7\.2/)
  assert.match(e.html, /did not pass any of 3 versions; this is the best one \(v2, 74\/100\)/)
  assert.match(e.html, /<b>Why this week:<\/b> People asked &amp; cared/)
  assert.match(e.html, /The Markdown file is attached: <b>ask-first\.md<\/b>/)
  assert.match(e.html, /href="https:\/\/m91-engine\.embarko\.app\/approvals\/261031-1000-ABCD">Open the post<\/a>/)
})

test('an approved post is emailed once, with the .md attached by a signed link; no Slack message; the journey says Emailed', async () => {
  const restore = quiet()
  const { store, notifier, r } = await fullRun(cfg(), { reviews: [{ pass: true, total: 88 }] })
  restore()
  assert.equal(r.status, 'succeeded', r.run?.result_summary)
  assert.match(r.run.result_summary, /approved automatically \(v1, score 88\); Markdown export: how-agent-approval-works\.md; emailed$/)
  assert.equal(notifier.sent.slack.length, 0, JSON.stringify(notifier.sent.slack))
  assert.equal(notifier.sent.mail.length, 1)
  const m = notifier.sent.mail[0]
  assert.deepEqual(m.to, ['me@example.com'])
  assert.equal(m.subject, 'New M91 post: How agent approval works with a phone call')
  assert.equal(m.filename, 'how-agent-approval-works.md')
  assert.match(m.attachment_url, new RegExp(`^https://m91-engine\\.embarko\\.app/files/exports/${r.run.brief_id}/\\d{10}/[a-f0-9]{32}/how-agent-approval-works\\.md$`))
  const [exp] = byType(store, 'markdown_export')
  assert.ok(exp.payload.email_sent_at)
  const j = buildJourney({ briefs: byType(store, 'brief'), drafts: byType(store, 'draft'), reviews: byType(store, 'review'), exportRec: exp, runs: byType(store, 'run'), target: 'email' })
  assert.deepEqual(j.stages.find((s) => s.id === 'published').detail, 'Emailed')
})

test('an engine on this computer sends the email without the attachment (Gmail cannot fetch a localhost link) and says so', async () => {
  const restore = quiet()
  const { notifier, r } = await fullRun(cfg({ ENGINE_PUBLIC_URL: '' }), { reviews: [{ pass: true, total: 88 }] })
  restore()
  assert.equal(notifier.sent.mail.length, 1)
  assert.equal(notifier.sent.mail[0].attachment_url, null)
  assert.match(notifier.sent.mail[0].html, /could not be attached/)
  const step = r.run.steps.find((s) => s.name === 'publisher')
  assert.equal(step.summary, 'Emailed to 1 address with how-agent-approval-works.md')
  assert.ok(r.run.warnings.some((w) => /http:\/\/localhost:8080, which Gmail cannot reach/.test(w)), JSON.stringify(r.run.warnings))
})

test('a malformed request target gets a 400 and the engine keeps running', async () => {
  const { createConnection } = await import('node:net')
  const store = (await fullRun(cfg(), { reviews: [{ pass: true, total: 88 }] })).store
  const conf = cfg()
  const manager = createRunManager({ config: conf, storeFactory: () => store, agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config: conf })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const { port } = server.address()
  const raw = (target) => new Promise((ok, no) => {
    const s = createConnection(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`))
    let out = ''
    s.on('data', (d) => { out += d })
    s.on('end', () => ok(out.split('\r\n')[0]))
    s.on('error', no)
  })
  try {
    for (const target of ['//', '/' + String.fromCharCode(92), 'http://']) assert.match(await raw(target), /^HTTP\/1\.1 400/, target)
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)
  } finally {
    await new Promise((ok) => server.close(ok))
  }
})

test('no MAIL_TO: the post stays approved and the run says why; the signed link serves the file without the login', async () => {
  const restore = quiet()
  const none = await fullRun(cfg({ MAIL_TO: '' }), { reviews: [{ pass: true, total: 88 }] })
  assert.equal(none.r.run.steps.find((s) => s.name === 'publisher').summary, 'Not emailed: MAIL_TO is empty')
  assert.ok(none.r.run.warnings.some((w) => /MAIL_TO is empty/.test(w)))
  // The attachment link, from a server with the login on: the file, no session needed; a tampered link: 404.
  const { store, notifier } = await fullRun(cfg(), { reviews: [{ pass: true, total: 88 }] })
  const url = new URL(notifier.sent.mail[0].attachment_url)
  const conf = cfg({ DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'a-long-test-password-123' })
  const manager = createRunManager({ config: conf, storeFactory: () => store, notifierFactory: () => notifier, agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config: conf })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const res = await fetch(base + url.pathname)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-disposition'), /attachment; filename="how-agent-approval-works\.md"/)
    assert.match(await res.text(), /^# How agent approval works/, 'the attachment is only the post')
    assert.equal((await fetch(base + url.pathname.replace(/\/[a-f0-9]{32}\//, `/${'0'.repeat(32)}/`))).status, 404)
    const login = await fetch(`${base}/api/exports/${url.pathname.split('/')[3]}/download`, { redirect: 'manual' })
    assert.equal(login.status, 302, 'the dashboard download still asks for the login')
  } finally {
    await new Promise((ok) => server.close(ok))
    restore()
  }
})

test('the notifier: one POST to the mail flow with the shared key; skipped (pending) without the flow URL; DRY_RUN sends nothing', async () => {
  const f = fakeFetch(() => ({ status: 200, body: { ok: true } }))
  const n = createNotifier({ config: fakeConfig({ MAIL_POST_WEBHOOK_URL: 'https://flow.sokt.io/func/scriFAKEMAIL', DRY_RUN: 'false' }), fetch: f })
  await n.mail({ to: ['me@example.com', 'you@example.com'], subject: 'S', html: '<p>H</p>', attachment_url: 'https://x/files/a.md', filename: 'a.md' })
  assert.equal(f.calls.length, 1)
  const { body } = f.calls[0]
  assert.deepEqual({ ...body, key: body.key ? 'set' : '' }, { key: 'set', to: 'me@example.com,you@example.com', subject: 'S', html: '<p>H</p>', attachment_url: 'https://x/files/a.md', filename: 'a.md' })
  const pending = createNotifier({ config: fakeConfig({ MAIL_POST_WEBHOOK_URL: '', DRY_RUN: 'false' }), fetch: f })
  const quietLog = quiet()
  assert.equal((await pending.mail({ to: ['me@example.com'], subject: 'S', html: 'H' })).skipped, 'pending_flows')
  assert.equal((await createNotifier({ config: fakeConfig({ DRY_RUN: 'true' }), fetch: f }).mail({ to: ['me@example.com'], subject: 'S', html: 'H' })).dryRun, true)
  quietLog()
  assert.equal(f.calls.length, 1)
  await assert.rejects(n.mail({ to: [], subject: 'S', html: 'H' }), /no recipient/)
})
