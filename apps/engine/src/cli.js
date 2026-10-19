// npm run pipeline                      — one pipeline (Scout + remaining stubs)
// npm run scout -- --mode=research      — the Scout alone
// npm run scout -- --mode=sources --brief-id=<id> --claims-file=<path.json> [--version=<n>]
//   claims file: ["claim 1", "claim 2"]  or  { "claims": [...], "reviewer_note": "..." }
// npm run strategist [-- --with-scout]   — plan one brief from the latest Scout data
// npm run strategist -- --mode=rebrief --brief-id=<id> --feedback-file=<path.json>
//   feedback file: [{ "area": "angle", "problem": "…", "fix": "…" }]  or  { "feedback": [...] }
// npm run brief -- --show <brief_id>
// npm run writer -- --brief-id=<id> [--brief-version=<n>] [--mode=revise --feedback-file=<path.json>]
// npm run draft -- --show <brief_id> [--version <n> [--brief-version <n>]]  |  --export <brief_id> [--version <n>] --out <file.md>
// npm run cleanup -- --list | --delete <memory_id …> | --delete-listed   (asks you to type "yes")
// npm run lessons -- --list | --delete <memory_id>
// npm run checks -- --file <post.md> --brief-id <id>
// npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"] | --list | --cancel <pinned_id>

import { readFile, writeFile } from 'node:fs/promises'
import { runWriter } from './writer/index.js'
import { draftsOf, draftVersion, draftBriefVersion } from './writer/save.js'
import { loadBrief, allowedUrlSet, tutorialSourceText, citedDocsSourceText } from './writer/inputs.js'
import { runContentChecks, parseMarkdown, urlKey } from './checks/content.js'
import { createUrlChecker } from './scout/checks.js'
import { pathToFileURL } from 'node:url'
import { getConfig, ConfigError } from './config.js'
import { log, registerSecrets, setLevel } from './util/log.js'
import { getStore, createStore } from './store.js'
import { findCandidates, deleteIds, PROTECTED_TYPES } from './cleanup.js'
import { extractSnippets } from './writer/snippets.js'
import { lessonText } from './lessons.js'
import { createNotifier } from './notify.js'
import { createRunManager } from './runs.js'
import { runScout } from './scout/index.js'
import { runStrategist } from './strategist/index.js'
import { listPins, addPin, cancelPin, DATE_RE } from './pins.js'

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

function printChecks(results) {
  console.table(results.map((r) => ({ check: r.id, severity: r.severity, passed: r.passed ? 'yes' : 'NO', value: r.value, detail: String(r.detail ?? '').slice(0, 70) })))
}

/** npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"] | --list | --cancel <id> */
export async function pinCommand(args, { store }) {
  if (args.list) {
    const pins = await listPins(store)
    if (!pins.length) return console.log('No pinned topics.')
    console.table(pins.map((p) => ({ pinned_id: p.pinned_id, date: p.target_date, priority: p.priority, status: p.status, topic: String(p.topic).slice(0, 70), used_by: p.used_by ?? '' })))
    return
  }
  if (args.cancel) {
    await cancelPin(store, args.cancel)
    return console.log(`Cancelled ${args.cancel}.`)
  }
  if (typeof args.topic !== 'string' || !DATE_RE.test(String(args.date))) throw new Error('usage: npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"]')
  const { pin, saved } = await addPin(store, { topic: args.topic, date: args.date, priority: args.priority === 'high' ? 'high' : undefined, notes: typeof args.notes === 'string' ? args.notes : undefined })
  console.log(saved ? `Pinned ${pin.pinned_id} for ${pin.target_date} (${pin.priority}).` : `DRY_RUN: not saved. Would pin ${pin.pinned_id} for ${pin.target_date}.`)
}

/** Reads one line from the terminal. */
async function ask(question) {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/** npm run cleanup -- --list | --delete <memory_id …> | --delete-listed */
export async function cleanupCommand(args, { store, confirm = ask, print = console.log, table = console.table }) {
  const show = (list) => {
    if (!list.length) return print('No candidate test records.')
    table(list.map((c) => ({ id: c.id, type: c.type, brief_id: c.brief_id ?? '', version: c.version ?? '', status: c.status ?? '', date: c.date ?? '', why: c.reasons.join('; ').slice(0, 80) })))
    print(`${list.length} candidate record(s). Protected types (${PROTECTED_TYPES.join(', ')}) are never listed.`)
  }
  if (args.list) return show(findCandidates(await store.getRecords({})))
  if (args['delete-listed']) {
    const list = findCandidates(await store.getRecords({}))
    show(list)
    if (!list.length) return
    if ((await confirm(`Type "yes" to delete these ${list.length} record(s): `)) !== 'yes') return print('Nothing deleted.')
    const r = await deleteIds(store, list.map((c) => c.id))
    return print(`Deleted ${r.deleted.length} record(s).${r.failed.length ? ` Failed: ${r.failed.map((f) => `${f.id} (${f.error})`).join(', ')}` : ''}`)
  }
  if (args.delete) {
    const ids = [args.delete, ...args._.slice(1)].filter((x) => typeof x === 'string' && x)
    if (!ids.length) throw new Error('usage: npm run cleanup -- --delete <memory_id …>')
    const r = await deleteIds(store, ids)
    return print(`Deleted ${r.deleted.length} record(s): ${r.deleted.join(', ')}${r.failed.length ? `. Failed: ${r.failed.map((f) => `${f.id} (${f.error})`).join(', ')}` : ''}`)
  }
  throw new Error('usage: npm run cleanup -- --list | --delete <memory_id …> | --delete-listed')
}

/** npm run lessons -- --list | --delete <memory_id> */
export async function lessonsCommand(args, { store, print = console.log, table = console.table }) {
  if (args.list) {
    const list = (await store.getRecords({ type: 'lesson' })).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    if (!list.length) return print('No lessons yet.')
    table(list.map((l) => ({ id: l.id, date: l.date ?? '', source: l.metadata?.source ?? '', brief_id: l.metadata?.brief_id ?? '', lesson: lessonText(l).slice(0, 100) })))
    return print(`${list.length} lesson(s). The Strategist and the Writer get the latest LESSONS_LIMIT of them.`)
  }
  if (typeof args.delete === 'string') {
    const rec = await store.getRecord(args.delete)
    if (!rec || rec.type !== 'lesson') throw new Error(`${args.delete} is not a lesson memory; nothing deleted`)
    await store.deleteRecord(args.delete)
    return print(`Deleted lesson ${args.delete}.`)
  }
  throw new Error('usage: npm run lessons -- --list | --delete <memory_id>')
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

  // Clean-up deletes for real even when DRY_RUN=true: it only removes ids you list or confirm.
  if (args._[0] === 'cleanup') return cleanupCommand(args, { store: createStore({ config, dryRun: false }) })
  if (args._[0] === 'lessons') return lessonsCommand(args, { store: createStore({ config, dryRun: false }) })

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

  if (args._[0] === 'writer') {
    if (!args['brief-id'] || args['brief-id'] === true) throw new Error('usage: npm run writer -- --brief-id=<id> [--brief-version=<n>] [--mode=revise --feedback-file=<path.json>]')
    const mode = args.mode ?? 'new'
    let feedback = []
    if (mode === 'revise') {
      if (!args['feedback-file']) throw new Error('revise mode needs --feedback-file=<path.json>')
      const file = JSON.parse(await readFile(args['feedback-file'], 'utf8'))
      feedback = Array.isArray(file) ? file : file.feedback
    }
    const { calls, draft, ...result } = await runWriter({ mode, briefId: args['brief-id'], briefVersion: args['brief-version'] ? Number(args['brief-version']) : undefined, feedback }, { config, store, notifier })
    log.info('writer finished', result)
    console.table(calls.map((c) => ({ call: c.call, model: c.model, delivery: c.delivery, ms: c.ms, result: c.result, hard_failures: c.hard_failures?.length ?? 0, error: c.error ? c.error.slice(0, 60) : '' })))
    printChecks(draft.checks.results)
    return
  }

  if (args._[0] === 'draft') {
    const id = args.show ?? args.export
    if (!id || id === true) throw new Error('usage: npm run draft -- --show <brief_id> [--version <n>]  |  --export <brief_id> [--version <n>] --out <file.md>')
    const all = await draftsOf(store, id)
    // Versions restart per brief version: --version picks within --brief-version (default: the newest one with that version).
    const d = args.version
      ? all.find((x) => draftVersion(x) === Number(args.version) && (!args['brief-version'] || draftBriefVersion(x) === Number(args['brief-version'])))
      : all[0]
    if (!d) return console.log(`No draft for ${id}${args.version ? ` v${args.version}` : ''}.`)
    if (args.export) {
      if (!args.out || args.out === true) throw new Error('--export needs --out <file.md>')
      await writeFile(args.out, d.payload.post_markdown, 'utf8')
      return console.log(`Exported ${id} v${d.version} (${d.status}) to ${args.out}`)
    }
    const p = d.payload
    console.log(`--- ${id} v${d.version} · ${d.status} · record ${d.id} · ${p.word_count} words · grades intro ${p.reading?.intro_grade} / post ${p.reading?.post_grade} · model ${p.model_used} · repairs ${p.repairs_used} ---`)
    printChecks(p.checks?.results ?? [])
    console.log(p.post_markdown)
    return
  }

  if (args._[0] === 'checks') {
    if (!args.file || !args['brief-id']) throw new Error('usage: npm run checks -- --file <post.md> --brief-id <id>')
    const md = await readFile(args.file, 'utf8')
    const briefRecord = await loadBrief(store, args['brief-id'])
    if (!briefRecord) throw new Error(`no brief ${args['brief-id']}`)
    const brief = briefRecord.payload
    const parsed = parseMarkdown(md)
    const isTutorial = brief.post_type === 'tutorial' || brief.tutorial?.use
    const { snippets } = extractSnippets(isTutorial ? await tutorialSourceText(brief, { config }) : await citedDocsSourceText(brief, { config }))
    const checker = createUrlChecker({ timeoutMs: config.scout.urlCheckTimeoutMs })
    const linkStatuses = new Map()
    await Promise.all([...new Set(parsed.links.map((l) => l.url))].map(async (u) => linkStatuses.set(urlKey(u), await checker.check(u))))
    // A bare Markdown file has no JSON answer or SEO fields: those two checks don't apply.
    const draft = { title: parsed.h1[0] ?? '', post_markdown: md, tldr: parsed.tldr ?? [], seo: { title_tag: 'n/a', meta_description: 'n/a', slug_suggestion: '' } }
    const r = runContentChecks({ draft, brief, config, allowedUrls: allowedUrlSet(brief, { ctaUrl: config.m91.ctaUrl, snippets }).set, snippets, linkStatuses })
    printChecks(r.results.filter((x) => x.id !== 'schema' && x.id !== 'seo_lengths'))
    console.log(`words ${r.word_count} · grades intro ${r.reading.intro_grade} / post ${r.reading.post_grade} · hard checks ${r.results.filter((x) => x.severity === 'hard' && x.id !== 'schema' && x.id !== 'seo_lengths').every((x) => x.passed) ? 'passed' : 'FAILED'}`)
    return
  }

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
