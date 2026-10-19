// Smoke tests against the real services. Run: npm run smoke  (node --env-file=.env smoke/run.js)
// Select tests with args: npm run smoke -- S1 S2   (default: S1–S4). S5 sends real Slack/M91 messages
// and only runs when named explicitly: npm run smoke -- S5

import { getConfig, AGENTS } from '../src/config.js'
import { registerSecrets, setLevel, maskString } from '../src/util/log.js'
import { createViaSocketClient } from '../src/viasocket.js'
import { createStore } from '../src/store.js'
import { createNotifier } from '../src/notify.js'
import { newBriefId } from '../src/util/ids.js'
import { istHuman } from '../src/util/time.js'

let config
try {
  config = getConfig()
} catch (error) {
  console.error(error.message)
  process.exit(2)
}
registerSecrets(config.secretValues)
setLevel(process.env.SMOKE_LOG_LEVEL || 'warn')

const args = process.argv.slice(2).map((a) => a.toUpperCase())
const selected = args.length ? args : ['S1', 'S2', 'S3', 'S4']
const rows = []
const record = (test, result, ms = '', model = '', note = '') => rows.push({ test, result, ms, model, note: maskString(note) })
const vs = createViaSocketClient({ config })

async function timed(fn) {
  const t = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t }
}

const TINY_SCHEMA = {
  name: 'smoke',
  strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['ok', 'word'], properties: { ok: { type: 'boolean' }, word: { type: 'string' } } }
}

async function s1() {
  try {
    const r = await vs.checkAuth()
    record('S1 GET /embed/authentications', r.status === 200 ? 'PASS (200)' : `FAIL (${r.status})`, r.ms, '', `${r.count ?? '?'} connections`)
  } catch (e) {
    record('S1 GET /embed/authentications', `FAIL (${e.status ?? e.kind})`, '', '', e.message)
  }
}

async function s2() {
  try {
    const r = await vs.call('POST', '/embed/ai/message', {
      message: 'Reply with ok=true and word="pong".',
      thread_id: `smoke-s2-${Date.now()}`,
      prompt: 'You are a test endpoint. Answer only with the JSON asked for.',
      service: config.scout.service,
      model: config.scout.model,
      response_type: 'json_schema',
      json_schema: TINY_SCHEMA
    })
    const content = r.payload?.data?.content
    const isObject = content !== null && typeof content === 'object'
    record('S2 sync json_schema', isObject ? 'PASS (object)' : `FAIL (${typeof content})`, '', config.scout.model, JSON.stringify(content).slice(0, 80))
  } catch (e) {
    record('S2 sync json_schema', `FAIL (${e.status ?? e.kind})`, '', config.scout.model, e.message)
  }
}

async function s3() {
  const briefId = newBriefId()
  await Promise.all(AGENTS.map(async (agent) => {
    const s = config[agent]
    try {
      const { value: r, ms } = await timed(() => vs.aiSend({
        agent,
        briefId: `smoke-${briefId}`,
        prompt: 'You are a test endpoint. Answer only with the JSON asked for.',
        message: 'Set ok to true. Set word to your model name if you know it, otherwise "unknown".',
        jsonSchema: TINY_SCHEMA
      }))
      const confirmed = r.model ? (r.model.includes(s.model) ? `yes (${r.model})` : `NO: ${r.model}`) : `not in response; model says "${String(r.content?.word).slice(0, 30)}"`
      record(`S3 ${agent} (${s.delivery})`, typeof r.content?.ok === 'boolean' ? 'PASS' : 'FAIL (content)', ms, `${s.service}/${s.model}`, `model confirmed: ${confirmed}`)
    } catch (e) {
      record(`S3 ${agent} (${s.delivery})`, `FAIL (${e.status ?? e.kind})`, '', `${s.service}/${s.model}`, e.message)
    }
  }))
}

async function s4() {
  if (config.runtime.dryRun) {
    record('S4 Mem0', 'SKIPPED', '', '', 'DRY_RUN=true: no Mem0 writes except run_log')
    return
  }
  const store = createStore({ config, testTag: true })
  const briefId = `smoke-${newBriefId()}`
  let id
  const step = async (name, fn) => {
    try {
      const { value, ms } = await timed(fn)
      record(`S4 Mem0 ${name}`, 'PASS', ms, '', value ?? '')
    } catch (e) {
      record(`S4 Mem0 ${name}`, 'FAIL', '', '', e.message)
      throw e
    }
  }
  try {
    await step('create', async () => { id = (await store.createRecord({ type: 'run_log', briefId, payload: { smoke: true, n: 1 }, status: 'smoke', version: 1 })).id; return `id ${id.slice(0, 8)}…` })
    await step('read', async () => {
      const r = await store.getOne('run_log', briefId)
      if (r?.id !== id || r.payload?.n !== 1) throw new Error('read back did not match')
    })
    await step('update', async () => {
      await store.updateRecord(id, { smoke: true, n: 2 }, { status: 'smoke-updated' })
      const r = await store.getOne('run_log', briefId)
      if (r?.payload?.n !== 2 || r.status !== 'smoke-updated') throw new Error('update not visible')
      const copies = await store.getRecords({ type: 'run_log', brief_id: briefId })
      if (copies.length !== 1) throw new Error(`${copies.length} copies after update`)
    })
    await step('search', async () => {
      const hits = await store.searchSimilar('smoke', { brief_id: briefId })
      return `${hits.length} hit(s)`
    })
    await step('delete', async () => {
      await store.deleteRecord(id)
      id = undefined
    })
    await step('long text (~10,000 chars)', async () => {
      const text = 'M91 rings a phone when an agent needs a human. '.repeat(213).slice(0, 10000)
      const r = await store.createRecord({ type: 'draft', briefId, payload: { text }, status: 'smoke', version: 1 })
      const back = await store.getOne('draft', briefId)
      await store.deleteRecord(r.id)
      const len = back?.payload?.text?.length ?? 0
      if (len !== text.length) throw new Error(`stored ${len} of ${text.length} chars`)
      return `fits: ${len} chars read back intact`
    })
  } catch {
    if (id) await store.deleteRecord(id).catch(() => {})
  }
}

async function s5() {
  if (config.runtime.dryRun) {
    record('S5 Slack + M91', 'SKIPPED', '', '', 'DRY_RUN=true sends nothing')
    return
  }
  const notifier = createNotifier({ config })
  const when = istHuman()
  try {
    const { ms } = await timed(() => notifier.slack(`Smoke test from M91 Blog Engine v2 (${when}). Please ignore.`))
    record('S5 Slack message', 'SENT (confirm receipt)', ms)
  } catch (e) {
    record('S5 Slack message', 'FAIL', '', '', e.message)
  }
  try {
    const { ms } = await timed(() => notifier.m91Alert({ title: 'Blog engine smoke test', description: `Test alert (${when}). Please ignore.`, severity: 'LOW' }))
    record('S5 M91 alert (LOW)', 'SENT (confirm receipt)', ms)
  } catch (e) {
    record('S5 M91 alert (LOW)', 'FAIL', '', '', e.message)
  }
}

async function scout() {
  const { scoutSmoke } = await import('./scout.smoke.js')
  try {
    const { first, second, src, slowest } = await scoutSmoke(config)
    record('SCOUT research', 'PASS', '', config.scout.model, `${first.calls_used} calls, slowest ${slowest?.call} ${slowest?.ms} ms`)
    record('SCOUT re-run', second.reused ? 'PASS (reused)' : config.runtime.dryRun ? 'n/a (DRY_RUN)' : 'FAIL (not reused)', '', '', `${second.calls.filter((c) => c.call.startsWith('questions')).length} question calls`)
    record('SCOUT sources', 'DONE (check verdicts)', '', '', `supported ${src.claims_supported}, unverified ${src.claims_unverified}, contradicted ${src.claims_contradicted}`)
  } catch (e) {
    record('SCOUT', 'FAIL', '', config.scout.model, e.message)
  }
}

async function strategist() {
  const { strategistSmoke } = await import('./strategist.smoke.js')
  try {
    const r = await strategistSmoke(config)
    record('STRATEGIST plan', 'PASS', '', config.strategist.model, `${r.first.post_type}, lead ${r.first.lead.id}, repairs ${r.first.repairs_used}`)
    record('STRATEGIST 2nd plan', r.second.lead.id !== r.first.lead.id ? 'PASS (different lead)' : 'FAIL (same lead)', '', '', `group ${r.first.topic_group} → ${r.second.topic_group}`)
    record('STRATEGIST re-brief angle', r.angle.brief_version === 2 && r.angle.lead.id === r.first.lead.id ? 'PASS' : 'CHECK', '', '', `v${r.angle.brief_version}, lead ${r.angle.lead.id}`)
    record('STRATEGIST re-brief dup', r.dup.lead.id !== r.second.lead.id ? 'PASS (new lead)' : 'FAIL (same lead)', '', '', `lead ${r.second.lead.id} → ${r.dup.lead.id}`)
    record('STRATEGIST pinned', r.pinned.post_type === 'pinned' ? 'PASS' : 'FAIL', '', '', `lead ${r.pinned.lead.id}`)
  } catch (e) {
    record('STRATEGIST', 'FAIL', '', config.strategist.model, e.message.split('\n').slice(0, 4).join(' | '))
  }
}

async function writer() {
  const { writerSmoke } = await import('./writer.smoke.js')
  try {
    const r = await writerSmoke(config)
    record('WRITER new', r.real.hard_passed ? 'PASS' : 'CHECK (hard failures)', '', r.real.model_used, `${r.real.word_count} words, grade ${r.real.reading.post_grade}, repairs ${r.real.repairs_used}`)
    record('WRITER revise', r.rev.version === r.real.version + 1 ? 'PASS' : 'CHECK', '', r.rev.model_used, `v${r.rev.version}, ${r.rev.draft.revision_notes.length} revision notes`)
    if (r.tutorial) record('WRITER tutorial', r.tutorial.draft.checks.results.find((x) => x.id === 'ai_written_code')?.passed ? 'PASS' : 'FAIL', '', r.tutorial.model_used, 'ai_written_code')
  } catch (e) {
    record('WRITER', 'FAIL', '', config.writer.model, e.message.split('\n')[0])
  }
}

const TESTS = { S1: s1, S2: s2, S3: s3, S4: s4, S5: s5, SCOUT: scout, STRATEGIST: strategist, WRITER: writer }
for (const name of selected) {
  if (!TESTS[name]) {
    console.error(`Unknown smoke test ${name}`)
    process.exitCode = 2
    continue
  }
  await TESTS[name]()
}
console.table(rows)
if (rows.some((r) => String(r.result).startsWith('FAIL'))) process.exitCode = 1
