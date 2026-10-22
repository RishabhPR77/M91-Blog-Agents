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
// npm run reviewer -- --brief-id=<id> [--version=<n>] [--brief-version=<n>] [--route]
// npm run promo -- --brief-id=<id> [--version=<n>]
// npm run designer -- --brief-id=<id> [--version=<n>]   the Experience Designer alone, on a waiting, approved or published draft (1–2 AI calls)
// npm run test:await -- --brief-id=<id> [--version=<n>]   TEST-ONLY, needs ALLOW_TEST_COMMANDS=true
// npm run publish -- --brief-id=<id> · unpublish -- --slug=<slug> · set-index -- --slug=<slug> --noindex=true|false · rebuild-blog
// npm run blog:sync   (published posts from Mem0 → apps/blog/src/content/posts; no build, no deploy)
// npm run approvals -- --list
// npm run approve -- --brief-id=<id> [--force-unreviewed]
// npm run review -- --brief-id=<id>   one Reviewer call on the waiting version (no routing)
// npm run revise -- --brief-id=<id> --feedback "<text>" [--quote "<exact sentence>"] … [--no-rereview]
//   (also reopens an approved, unpublished draft; --no-rereview skips the Reviewer for this run)
// npm run reject -- --brief-id=<id> [--reason "<text>"]
// npm run checks -- --file <post.md> --brief-id <id>
// npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"] | --list | --cancel <pinned_id>

import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
import { setAwaitingForTest } from './testcommands.js'
import { exportPublished } from './publisher/export.js'
import { weightsFor } from './reviewer/decide.js'
import { createNotifier } from './notify.js'
import { createRunManager } from './runs.js'
import { runScout } from './scout/index.js'
import { runStrategist } from './strategist/index.js'
import { listPins, addPin, cancelPin, DATE_RE } from './pins.js'
import { engineUrl, runViaEngine, engineApi } from './enginecall.js'
import { usageStatus, setUsage } from './util/mem0usage.js'
import { previewExport, exportDir } from './export/index.js'

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
export async function pinCommand(args, { store, engine = null }) {
  if (args.list) {
    const pins = await listPins(store)
    if (!pins.length) return console.log('No pinned topics.')
    console.table(pins.map((p) => ({ pinned_id: p.pinned_id, date: p.target_date, priority: p.priority, status: p.status, topic: String(p.topic).slice(0, 70), used_by: p.used_by ?? '' })))
    return
  }
  if (args.cancel) {
    if (engine) await engineApi.cancelPin(engine, args.cancel)
    else await cancelPin(store, args.cancel)
    return console.log(`Cancelled ${args.cancel}.`)
  }
  if (typeof args.topic !== 'string' || !DATE_RE.test(String(args.date))) throw new Error('usage: npm run pin -- --topic "<text>" --date YYYY-MM-DD [--priority high] [--notes "<text>"]')
  const input = { topic: args.topic, date: args.date, priority: args.priority === 'high' ? 'high' : undefined, notes: typeof args.notes === 'string' ? args.notes : undefined }
  const { pin, saved } = engine
    ? await engineApi.addPin(engine, { ...input, target_date: input.date }).then((r) => ({ pin: r.pinned, saved: r.saved }))
    : await addPin(store, input)
  console.log(saved ? `Pinned ${pin.pinned_id} for ${pin.target_date} (${pin.priority}).` : `DRY_RUN: not saved. Would pin ${pin.pinned_id} for ${pin.target_date}.`)
}

/**
 * Starts a run and waits for it: through the running engine when it is up (Phase 9 A4: its index stays
 * current and the dashboard shows the run live), else in this process.
 */
export async function startAndWait(config, { mode, params = {}, dryRun, engineUrlFn = engineUrl, viaEngine = runViaEngine, managerFactory = () => createRunManager({ config }), print = console.log } = {}) {
  const base = await engineUrlFn(config)
  if (base) {
    print(`Running through the engine at ${base} (watch it live in the dashboard).`)
    return viaEngine(base, { mode, params, dryRun, onStart: (id) => print(`run ${id} started`) })
  }
  const manager = managerFactory()
  const { run_id } = await manager.startRun({ mode, trigger: 'cli', params, ...(dryRun && { dryRun: true }) })
  return manager.wait(run_id)
}

/** The Experience Designer's result: chapters and components, what was dropped (with reasons), checks, calls. */
export function printDesigner(d, print = console.log) {
  print(`--- Experience Designer for ${d.brief_id} v${d.version} · ${d.status} · ${d.model_used} · repairs ${d.repairs_used} · guide_doc ${d.record_id} ---`)
  print(d.summary_line)
  if (d.guide) {
    for (const c of d.guide.chapters) print(`  ${String(c.number).padStart(2, '0')} — ${c.label}: ${c.components.map((x) => x.type).join(', ')}`)
  }
  print(`DROPPED (${d.dropped?.length ?? 0})`)
  for (const x of d.dropped ?? []) print(`  ${x.type ?? 'component'} (chapter ${x.chapter}): ${x.reason}`)
  print(`COVERAGE ${d.coverage?.passed ? 'passed' : 'FAILED'}${d.coverage?.details?.length ? `: ${d.coverage.details.join(' | ')}` : ''}`)
  print(`CHECKS first answer ${d.checks?.first?.length ?? 0} problem(s) · final ${d.checks?.final?.length ?? 0}`)
  if (d.error) print(`NO GUIDE: ${d.error}`)
}

/** A review in full: gates and areas with evidence, total, feedback with quote_found, sources, lessons. */
export function printReview(r, print = console.log) {
  print(`--- review of ${r.brief_id} v${r.version} (brief v${r.brief_version}) · ${r.model_used} · ${r.ms} ms · repairs ${r.repairs_used} · record ${r.record_id} ---`)
  print('GATES')
  for (const g of r.gates) print(`  ${g.passed ? 'pass' : 'FAIL'}  ${g.id} (${g.source}): ${g.evidence}`)
  print('AREAS')
  for (const a of r.areas) print(`  ${String(a.score).padStart(2)}/10 ×${weightsFor(r.areas.some((x) => x.id === 'experience'))[a.id]}  ${a.id}: ${a.evidence}`)
  print(`TOTAL ${r.total}/100 · ${r.pass ? 'PASS' : 'FAIL'}${r.route_hint ? ` → ${r.route_hint}` : ''}`)
  print(`FEEDBACK (${r.feedback.length})`)
  for (const f of r.feedback) print(`  [${f.severity} → ${f.send_to}] ${f.area} · quote_found ${f.quote_found}\n    quote: "${f.quote}"\n    problem: ${f.problem}\n    fix: ${f.fix}${f.claims?.length ? `\n    claims: ${f.claims.join(' | ')}` : ''}`)
  if (r.fixed_previous.length) {
    print('FIXED FROM THE PREVIOUS REVIEW')
    for (const x of r.fixed_previous) print(`  ${x.fixed ? 'fixed' : 'NOT fixed'}: "${x.previous_quote}" — ${x.note}`)
  }
  print(`SOURCES CHECKED (${r.sources_checked.length})`)
  for (const s of r.sources_checked) print(`  ${s.verdict}: ${s.url} — ${s.claim}`)
  print(`LESSONS (${r.lessons.length})`)
  for (const l of r.lessons) print(`  - ${l}`)
  print(`SUMMARY: ${r.summary}`)
  for (const w of r.warnings ?? []) print(`WARNING: ${w}`)
}

/** A promo pack in full, with its checks. */
export function printPromo(r, print = console.log) {
  const p = r.pack
  print(`--- promo pack for ${r.brief_id} v${r.version} · ${r.status} · ${r.model_used} · repairs ${r.repairs_used} · record ${r.record_id} ---`)
  print(`LINKEDIN (${p.linkedin_post.length} chars)\n${p.linkedin_post}`)
  print(`X THREAD (${p.x_thread.length} posts)`)
  p.x_thread.forEach((t, i) => print(`  ${i + 1}. (${t.length}) ${t}`))
  print(`NEWSLETTER (${p.newsletter_blurb.trim().split(/\s+/).length} words)\n${p.newsletter_blurb}`)
  print('VIDEO SCRIPT')
  p.video_script.forEach((s, i) => print(`  ${i + 1}. [${s.on_screen_text}] ${s.voiceover}`))
  print(`COMMUNITY QUESTION\n${p.community_question}`)
  print(r.problems.length ? `CHECKS: ${r.problems.length} problem(s)\n${r.problems.map((x) => `  - ${x}`).join('\n')}` : 'CHECKS: all passed')
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

/**
 * npm run reset:all -- [--dry-run]  (Phase 12): counts every Mem0 memory under MEM0_AGENT_ID by type and the
 * local leftovers; without --dry-run, asks for "yes", then deletes them (Mem0's delete-all for our agent id
 * only) and clears exports/ and data/ (keeping data/mem0-usage.json). Prints the Mem0 requests it used.
 */
export async function resetCommand(args, { store, config, confirm = ask, print = console.log, sleepFn }) {
  const { planReset, runReset, planLines } = await import('./reset.js')
  const { withMem0Count, mem0Requests } = await import('./util/mem0count.js')
  const { counts, result } = withMem0Count(async () => {
    if (args['dry-run']) {
      const plan = await planReset({ store, config })
      for (const l of planLines(plan)) print(l)
      print('Dry run: nothing was deleted.')
      return plan
    }
    return runReset({
      store, config, ...(sleepFn && { sleepFn }),
      confirm: async (plan) => {
        for (const l of planLines(plan)) print(l)
        if (plan.total === 0 && !plan.local.exports.files && !plan.local.data.entries.length) {
          print('Nothing to delete.')
          return false
        }
        return (await confirm(`Type "yes" to delete these ${plan.total} Mem0 memories and the local files listed: `)) === 'yes'
      }
    })
  })
  const r = await result
  if (!args['dry-run']) {
    if (!r.done) print('Nothing deleted.')
    else {
      print(`Deleted ${r.deleted} Mem0 memories (left: ${r.left}). Local: ${r.removedLocal.length ? r.removedLocal.join(', ') : 'nothing'}.`)
      if (r.left) print(`${r.left} memories are still listed: Mem0 deletes in the background (event ${r.event_id ?? 'unknown'}). Run the dry run again in a few minutes (1 Mem0 request).`)
      print('A running engine now says its data may be out of date: click Refresh from Mem0 in the dashboard.')
    }
  }
  print(`Mem0 requests: ${mem0Requests(counts)} (reads ${counts.reads} · writes ${counts.writes})`)
  return r
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
export async function lessonsCommand(args, { store, engine = null, print = console.log, table = console.table }) {
  if (args.list) {
    const list = (await store.getRecords({ type: 'lesson' })).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    if (!list.length) return print('No lessons yet.')
    table(list.map((l) => ({ id: l.id, date: l.date ?? '', source: l.metadata?.source ?? '', brief_id: l.metadata?.brief_id ?? '', lesson: lessonText(l).slice(0, 100) })))
    return print(`${list.length} lesson(s). The Strategist and the Writer get the latest LESSONS_LIMIT of them.`)
  }
  if (typeof args.delete === 'string') {
    // Through the running engine when it is up (it checks that the id is a lesson).
    if (engine) {
      await engineApi.deleteLesson(engine, args.delete)
      return print(`Deleted lesson ${args.delete}.`)
    }
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

  // Phase 9 A5: this month's Mem0 usage estimate; --set=<n> takes the figure from the Mem0 console.
  if (args._[0] === 'mem0-usage') {
    const u = args.set !== undefined ? setUsage(config, Number(args.set)) : usageStatus(config)
    console.log(`Mem0 requests this month (${u.month}, estimate): ${u.used}/${u.limit} (${u.pct}%) · level ${u.level} · resets ${u.resets_on.slice(0, 10)}${u.seed ? ` · ${u.seed} from the Mem0 console` : ''}`)
    console.log(`counted here: reads ${u.total.reads}, searches ${u.total.searches}, writes ${u.total.writes}. The Mem0 console has the exact figure.`)
    return
  }

  // Phase 12: the fresh start. It deletes for real even when DRY_RUN=true, after "yes".
  if (args._[0] === 'reset') return resetCommand(args, { store: createStore({ config, dryRun: false }), config })
  // Clean-up deletes for real even when DRY_RUN=true: it only removes ids you list or confirm.
  if (args._[0] === 'cleanup') return cleanupCommand(args, { store: createStore({ config, dryRun: false }) })
  if (args._[0] === 'lessons') return lessonsCommand(args, { store: createStore({ config, dryRun: false }), engine: typeof args.delete === 'string' ? await engineUrl(config) : null })

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

  if (args._[0] === 'pin') return pinCommand(args, { store, engine: args.list ? null : await engineUrl(config) })

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

  // TEST-ONLY (ALLOW_TEST_COMMANDS=true): put an existing draft at awaiting_human for a cheap approval test.
  if (args._[0] === 'test-await') {
    const r = await setAwaitingForTest(createStore({ config, dryRun: false }), config, { briefId: args['brief-id'], version: args.version ? Number(args.version) : undefined })
    console.log(`TEST: ${r.brief_id} v${r.version} (brief v${r.brief_version}) ${r.previous_status} → awaiting_human · score ${r.total ?? 'none'} · draft and brief marked test data`)
    return
  }

  // Phase 11: the Markdown export of a reviewed draft (0 AI calls). Without --save: the file only (exports folder,
  // or --out), nothing saved in Mem0. With --save: the final export (the brief's markdown_export record + the file).
  if (args._[0] === 'export') {
    if (typeof args['brief-id'] !== 'string') throw new Error('usage: npm run export -- --brief-id=<id> [--version=<n>] [--save] [--out=<folder>]')
    const version = args.version ? Number(args.version) : undefined
    if (args.save) {
      const result = await startAndWait(config, { mode: 'export', params: { brief_id: args['brief-id'], save: true, ...(version && { version }) } })
      console.log(`${result.status}: ${result.run?.result_summary ?? result.error ?? ''}`)
      for (const w of result.run?.warnings ?? []) console.log(`WARNING: ${w}`)
      process.exitCode = result.status === 'succeeded' ? 0 : 1
      return
    }
    const engine = await engineUrl(config)
    const out = engine ? await engineApi.markdown(engine, args['brief-id'], version) : await previewExport({ store, config, briefId: args['brief-id'], version })
    const dir = typeof args.out === 'string' ? resolve(args.out) : exportDir(config)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, out.filename)
    writeFileSync(file, out.markdown, 'utf8')
    console.log(`Wrote ${file} (v${out.version}, ${out.markdown.length.toLocaleString('en-US')} characters${engine ? ', read through the engine' : ''}). Not saved in Mem0: add --save for the final export.`)
    for (const w of out.warnings ?? []) console.log(`WARNING: ${w}`)
    return
  }

  // Phase 7: the Publisher (no AI calls). Each runs as a normal run: lock, events, run record.
  if (['publish', 'unpublish', 'set-index', 'rebuild-blog'].includes(args._[0])) {
    const mode = { publish: 'publish', unpublish: 'unpublish', 'set-index': 'set_index', 'rebuild-blog': 'rebuild_blog' }[args._[0]]
    const usage = { publish: '--brief-id=<id>', unpublish: '--slug=<slug>', set_index: '--slug=<slug> --noindex=true|false', rebuild_blog: '' }[mode]
    const params = {}
    if (mode === 'publish') params.brief_id = args['brief-id']
    if (mode === 'unpublish' || mode === 'set_index') params.slug = args.slug
    if (mode === 'set_index') params.noindex = args.noindex === 'true' ? true : args.noindex === 'false' ? false : undefined
    if (Object.values(params).some((v) => v === undefined || v === true)) throw new Error(`usage: npm run ${args._[0]} -- ${usage}`)
    const result = await startAndWait(config, { mode, params })
    console.table((result.run?.steps ?? []).map((s) => ({ step: s.name, status: s.status, ms: s.ms, summary: String(s.summary).slice(0, 90), error: s.error ? String(s.error).slice(0, 60) : '' })))
    console.log(`${result.status}: ${result.run?.result_summary ?? result.error ?? ''}`)
    for (const w of result.run?.warnings ?? []) console.log(`WARNING: ${w}`)
    process.exitCode = result.status === 'succeeded' ? 0 : 1
    return
  }

  // Phase 7: write the published posts from Mem0 into apps/blog/src/content/posts (no build, no deploy).
  if (args._[0] === 'blog-sync') {
    const { files } = await exportPublished(store)
    console.log(files.length ? `Wrote ${files.length} post file(s) to apps/blog/src/content/posts: ${files.join(', ')}` : 'No published posts: apps/blog/src/content/posts is empty (npm run dev:blog shows the samples).')
    return
  }

  if (args._[0] === 'approvals') {
    if (!args.list) throw new Error('usage: npm run approvals -- --list')
    const waiting = await store.getRecords({ type: 'draft', status: 'awaiting_human' })
    if (!waiting.length) return console.log('No drafts are waiting for your approval.')
    console.table(waiting.map((d) => ({ brief_id: d.briefId, version: d.version, title: String(d.payload?.title ?? '').slice(0, 60), score: d.metadata?.review_total ?? '', waiting_since: d.metadata?.awaiting_since ?? '' })))
    return
  }

  // The human's decisions on a waiting draft (Phase 5.5): approve | revise | reject.
  if (['approve', 'revise', 'reject', 'review'].includes(args._[0])) {
    const mode = { approve: 'approve', revise: 'human_revise', reject: 'reject_topic', review: 'approval_review' }[args._[0]]
    if (typeof args['brief-id'] !== 'string') throw new Error(`usage: npm run ${args._[0]} -- --brief-id=<id>${args._[0] === 'revise' ? ' --feedback "<text>" [--quote "<exact sentence>"]' : args._[0] === 'reject' ? ' [--reason "<text>"]' : ''}`)
    const params = { brief_id: args['brief-id'] }
    if (mode === 'human_revise') {
      params.feedback = typeof args.feedback === 'string' ? args.feedback : ''
      const quotes = process.argv.slice(2).flatMap((a, i, all) => (a === '--quote' ? [all[i + 1]] : a.startsWith('--quote=') ? [a.slice(8)] : [])).filter(Boolean)
      if (quotes.length) params.quotes = quotes
      if (args['no-rereview']) params.rereview_after_human = false
    }
    if (mode === 'reject_topic' && typeof args.reason === 'string') params.reason = args.reason
    if (mode === 'approve' && args['force-unreviewed']) params.force_unreviewed = true
    const result = await startAndWait(config, { mode, params })
    console.table((result.run?.steps ?? []).map((s) => ({ step: s.name, status: s.status, ms: s.ms, ai_calls: s.ai_calls, summary: String(s.summary).slice(0, 80), error: s.error ? String(s.error).slice(0, 50) : '' })))
    console.log(`${result.status}: ${result.run?.result_summary ?? result.error ?? ''}`)
    for (const w of result.run?.warnings ?? []) console.log(`WARNING: ${w}`)
    process.exitCode = result.status === 'succeeded' ? 0 : 1
    return
  }

  if (args._[0] === 'designer') {
    if (typeof args['brief-id'] !== 'string') throw new Error('usage: npm run designer -- --brief-id=<id> [--version=<n>]')
    const params = { brief_id: args['brief-id'], ...(args.version && { version: Number(args.version) }) }
    const result = await startAndWait(config, { mode: 'designer', params })
    if (result.output) printDesigner(result.output)
    else console.log(`${result.status}: ${result.run?.result_summary ?? result.error ?? ''}`)
    process.exitCode = result.status === 'succeeded' ? 0 : 1
    return
  }

  if (args._[0] === 'reviewer' || args._[0] === 'promo') {
    const mode = args._[0]
    if (typeof args['brief-id'] !== 'string') throw new Error(`usage: npm run ${mode} -- --brief-id=<id> [--version=<n>] [--brief-version=<n>]${mode === 'reviewer' ? ' [--route]' : ''}`)
    const params = {
      brief_id: args['brief-id'],
      ...(args.version && { version: Number(args.version) }),
      ...(args['brief-version'] && { brief_version: Number(args['brief-version']) }),
      ...(mode === 'reviewer' && { route: args.route === true })
    }
    const result = await startAndWait(config, { mode, params })
    const run_id = result.run_id ?? result.run?.run_id
    if (result.output) (mode === 'reviewer' ? printReview : printPromo)(result.output)
    else console.table((result.run?.steps ?? []).map((s) => ({ step: s.name, status: s.status, ms: s.ms, summary: String(s.summary).slice(0, 70), error: s.error ? String(s.error).slice(0, 50) : '' })))
    log.info('run finished', { run_id, status: result.status, summary: result.run?.result_summary, warnings: result.warnings?.length ?? 0 })
    process.exitCode = result.status === 'succeeded' ? 0 : 1
    return
  }

  // npm run pipeline  (= run --mode=full), or: node src/cli.js run --mode=scout|strategist|full [--dry-run]
  const mode = args._[0] === 'run' ? args.mode ?? 'full' : 'full'
  log.info('run starting', { mode, dryRun: args['dry-run'] ? true : config.runtime.dryRun })
  const result = await startAndWait(config, { mode, ...(args['dry-run'] && { dryRun: true }) })
  const run_id = result.run_id ?? result.run?.run_id
  const run = result.run ?? {}
  console.table((run.steps ?? []).map((s) => ({ step: s.name, status: s.status, ms: s.ms, ai_calls: s.ai_calls, models: (s.models ?? []).join(' '), summary: String(s.summary).slice(0, 70), error: s.error ? String(s.error).slice(0, 50) : '' })))
  log.info('run finished', { run_id, status: result.status, brief_id: run.brief_id, summary: run.result_summary, ms: run.ms })
  process.exitCode = result.status === 'succeeded' ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    log.error('command failed', { error })
    process.exitCode = 1
  })
}
