// npm run pipeline                      — one pipeline (Scout + remaining stubs)
// npm run scout -- --mode=research      — the Scout alone
// npm run scout -- --mode=sources --brief-id=<id> --claims-file=<path.json> [--version=<n>]
//   claims file: ["claim 1", "claim 2"]  or  { "claims": [...], "reviewer_note": "..." }
// npm run strategist [-- --with-scout]   — plan one brief from the latest Scout data
// npm run strategist -- --mode=rebrief --brief-id=<id> --feedback-file=<path.json>
//   feedback file: [{ "area": "angle", "problem": "…", "fix": "…" }]  or  { "feedback": [...] }
// npm run brief -- --show <brief_id>
// npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"] | --list | --cancel <pinned_id>

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { getConfig, ConfigError } from './config.js'
import { log, registerSecrets, setLevel } from './util/log.js'
import { getStore } from './store.js'
import { createNotifier } from './notify.js'
import { createRunManager } from './runs.js'
import { runScout } from './scout/index.js'
import { runStrategist } from './strategist/index.js'
import { newRecordId } from './util/ids.js'

/** --key=value, --key value, or a bare --flag (true). Anything else is positional. */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/)
    if (!m) out._.push(argv[i])
    else if (m[2] !== undefined) out[m[1]] = m[2]
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && out._.length > 0) out[m[1]] = argv[++i]
    else out[m[1]] = true
  }
  return out
}

async function scoutCommand(args, { config, store, notifier }) {
  const mode = args.mode ?? 'research'
  if (mode === 'research') return runScout({ mode }, { config, store, notifier })
  if (mode !== 'sources') throw new Error('--mode must be research or sources')
  if (!args['brief-id'] || !args['claims-file']) throw new Error('sources mode needs --brief-id=<id> and --claims-file=<path.json>')
  const file = JSON.parse(await readFile(args['claims-file'], 'utf8'))
  const claims = Array.isArray(file) ? file : file.claims
  return runScout({ mode, briefId: args['brief-id'], version: args.version ? Number(args.version) : undefined, claims, reviewerNote: file.reviewer_note }, { config, store, notifier })
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"] | --list | --cancel <id> */
export async function pinCommand(args, { store }) {
  if (args.list) {
    const pins = (await store.getRecords({ type: 'pinned_topic' })).sort((a, b) => String(a.payload?.target_date).localeCompare(String(b.payload?.target_date)))
    if (!pins.length) return console.log('No pinned topics.')
    console.table(pins.map((p) => ({ pinned_id: p.payload.pinned_id, date: p.payload.target_date, priority: p.payload.priority, status: p.status, topic: String(p.payload.topic).slice(0, 70), used_by: p.payload.used_by ?? '' })))
    return
  }
  if (args.cancel) {
    const pin = (await store.getRecords({ type: 'pinned_topic' })).find((p) => p.payload?.pinned_id === args.cancel)
    if (!pin) throw new Error(`No pinned topic ${args.cancel}`)
    await store.updateRecord(pin.id, pin.payload, { status: 'cancelled' })
    return console.log(`Cancelled ${args.cancel}.`)
  }
  const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
  if (!topic || !DATE_RE.test(String(args.date))) throw new Error('usage: npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"]')
  const priority = args.priority === 'high' ? 'high' : 'normal'
  const payload = { pinned_id: newRecordId('PIN'), topic, target_date: args.date, priority, notes: typeof args.notes === 'string' ? args.notes : '' }
  const rec = await store.createRecord({ type: 'pinned_topic', briefId: null, payload, status: 'open' })
  console.log(rec.dryRun ? `DRY_RUN: not saved. Would pin ${payload.pinned_id} for ${payload.target_date}.` : `Pinned ${payload.pinned_id} for ${payload.target_date} (${priority}).`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let config
  try {
    config = getConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(2)
    }
    throw error
  }
  registerSecrets(config.secretValues)
  setLevel(config.runtime.logLevel)
  const store = getStore()
  const notifier = createNotifier({ config })

  if (args._[0] === 'strategist') {
    let scoutResult
    if (args['with-scout']) {
      const { calls, ...r } = await runScout({ mode: 'research' }, { config, store, notifier })
      scoutResult = r
      log.info('scout finished', { run_id: r.run_id, reused: r.reused, calls_used: r.calls_used })
    }
    const mode = args.mode ?? 'plan'
    let params = { mode, scoutResult }
    if (mode === 'rebrief') {
      if (!args['brief-id'] || !args['feedback-file']) throw new Error('rebrief needs --brief-id=<id> and --feedback-file=<path.json>')
      const file = JSON.parse(await readFile(args['feedback-file'], 'utf8'))
      params = { mode, runId: args['brief-id'], briefId: args['brief-id'], briefVersion: args.version ? Number(args.version) : undefined, feedback: Array.isArray(file) ? file : file.feedback }
    }
    const { calls, brief, ...result } = await runStrategist(params, { config, store, notifier })
    log.info('strategist finished', result)
    console.table(calls.map((c) => ({ call: c.call, model: c.model, delivery: c.delivery, ms: c.ms, result: c.result, problems: c.problems?.length ?? 0, auto_fixes: c.auto_fixes?.length ?? 0, error: c.error ? c.error.slice(0, 60) : '' })))
    console.log(JSON.stringify(brief, null, 2))
    return
  }

  if (args._[0] === 'brief') {
    const id = args.show
    if (!id || id === true) throw new Error('usage: npm run brief -- --show <brief_id>')
    const versions = (await store.getRecords({ type: 'brief', brief_id: id })).sort((a, b) => (a.payload?.brief_version ?? 0) - (b.payload?.brief_version ?? 0))
    if (!versions.length) return console.log(`No brief ${id} in Mem0.`)
    for (const v of versions) console.log(`--- ${id} v${v.payload?.brief_version ?? v.version} · status ${v.status} · record ${v.id} ---\n${JSON.stringify(v.payload, null, 2)}`)
    return
  }

  if (args._[0] === 'pin') return pinCommand(args, { store })

  if (args._[0] === 'scout') {
    log.info('scout starting', { mode: args.mode ?? 'research', dryRun: config.runtime.dryRun })
    const { calls, ...result } = await scoutCommand(args, { config, store, notifier })
    log.info('scout finished', result)
    console.table(calls.map((c) => ({ call: c.call, model: c.model, delivery: c.delivery, ms: c.ms, returned: c.items_returned, kept: c.items_kept, dropped: c.items_dropped, retries: c.retries, error: c.error ? c.error.slice(0, 60) : '' })))
    return
  }

  // npm run pipeline  (= run --mode=full), or: node src/cli.js run --mode=scout|strategist|full [--dry-run]
  const mode = args._[0] === 'run' ? args.mode ?? 'full' : 'full'
  const manager = createRunManager({ config })
  const { run_id } = await manager.startRun({ mode, trigger: 'cli', ...(args['dry-run'] && { dryRun: true }) })
  log.info('run started', { run_id, mode, dryRun: args['dry-run'] ? true : config.runtime.dryRun })
  const result = await manager.wait(run_id)
  const run = result.run ?? {}
  console.table((run.steps ?? []).map((s) => ({ step: s.name, status: s.status, ms: s.ms, ai_calls: s.ai_calls, models: s.models.join(' '), summary: String(s.summary).slice(0, 70), error: s.error ? String(s.error).slice(0, 50) : '' })))
  log.info('run finished', { run_id, status: result.status, brief_id: run.brief_id, summary: run.result_summary, ms: run.ms })
  process.exitCode = result.status === 'succeeded' ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    log.error('command failed', { error })
    process.exitCode = 1
  })
}
