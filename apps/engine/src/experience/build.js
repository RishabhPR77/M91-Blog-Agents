// The Experience Designer's plan → the guide (Phase 10, C2/C3). Pure code. Components that show the Writer's text
// get it from the post's parts (exact source slices, the Phase 8 builders); code comes from a code part or a
// snippet. A component that does not fit its pattern is dropped: if it held parts, they become prose, so the
// post's text is never lost. Returns the guide (or null), what was dropped, the coverage result and every piece
// of text the Designer wrote (for the no-new-facts checks).
//
// Keys: every component of the plan is "<chapter index>:<component index>"; the hero, a chapter ("c<n>") and the
// "your_turn" strip have their own keys. The checks report problems by key; a second build can drop keys.

import { validateGuide, FILE_LANGUAGES } from '@m91/content'
import { buildFromParts } from '../designer/build.js'
import { textOf } from '../designer/parts.js'
import { insertedCode } from '../writer/snippets.js'

const STATE_ACTOR = { waiting: 'agent', ringing: 'm91', approved: 'human', rejected: 'human', continuing: 'software' }
const PART_TYPES = ['prose', 'phone_ring_sim', 'steps_checklist', 'troubleshooting_picker', 'comparison_table', 'faq']
export const GENERIC_HERO = Object.freeze({ example: true, agent: 'Your agent', request: 'Needs a decision before it acts', person: 'the person who decides', decision: 'approved', result: 'Carries on with the answer' })
export const GENERIC_YOUR_TURN = 'Let your agent ask before it acts.'
const LANG = { bash: 'bash', sh: 'bash', shell: 'bash', console: 'console', powershell: 'powershell', json: 'json', js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', python: 'python', py: 'python', yaml: 'yaml', yml: 'yaml', http: 'http' }
const fileLanguage = (l) => (FILE_LANGUAGES.includes(LANG[String(l ?? '').toLowerCase()]) ? LANG[String(l).toLowerCase()] : 'text')
const EXT = { bash: 'sh', json: 'json', js: 'js', ts: 'ts', python: 'py', yaml: 'yaml' }
const t = (s) => String(s ?? '').trim()

/**
 * @param {object} plan  the Designer's answer (schemas.js)
 * @param {{ title: string, parsed: { markdown, parts }, snippets?: object[], maxComponents?: number, drop?: Set<string> }} input
 *   drop: plan keys to leave out (components that still failed the checks after the repair)
 * @returns {{ guide: object|null, dropped: object[], coverage: { passed, details }, authored: object[], problems: string[], ids: Map<string,string> }}
 *   authored: { key, field, text, example }; ids: plan key → component id in the guide
 */
export function buildGuide(plan, { title, parsed, snippets = [], maxComponents = 10, drop = new Set() }) {
  const { markdown: md, parts } = parsed
  const index = new Map(parts.map((p, i) => [p.id, i]))
  const snippetById = new Map(snippets.map((s) => [s.id, s]))
  const used = []
  const dropped = []
  const problems = []
  const authored = []
  let designed = 0
  const say = (key, field, text, example = false) => { if (t(text)) authored.push({ key, field, text: t(text), example }) }

  function partRange(ids) {
    if (!Array.isArray(ids) || !ids.length) return { reason: 'no part ids' }
    const pos = ids.map((id) => index.get(id))
    if (pos.some((p) => p === undefined)) return { reason: `unknown part id(s): ${ids.filter((id) => !index.has(id)).join(', ')}` }
    if (pos.some((p, k) => k > 0 && p !== pos[k - 1] + 1)) return { reason: 'the part ids are not consecutive and in order' }
    return { pos }
  }
  const proseOf = (pos) => ({ type: 'prose', data: { markdown: md.slice(parts[pos[0]].start, parts[pos.at(-1)].end), part_ids: pos.map((p) => parts[p].id) }, pos })

  const chapters = (plan?.chapters ?? []).map((ch, ci) => {
    const n = ci + 1
    const ckey = `c${n}`
    let heading = ''
    const comps = []
    const hid = t(ch.heading_part_id)
    if (hid) {
      const at = index.get(hid)
      const p = parts[at]
      if (!p) problems.push(`chapter ${n}: heading_part_id ${hid} is not a part`)
      else if (p.type !== 'heading' || p.depth !== 2) {
        problems.push(`chapter ${n}: heading_part_id ${hid} is not an H2 heading (it is kept as prose)`)
        comps.push(proseOf([at]))
        used.push(hid)
      } else {
        heading = textOf(p.node).replace(/\s+/g, ' ').trim()
        used.push(hid)
      }
    }
    if (!heading) {
      heading = t(ch.heading) || t(ch.label) || `Chapter ${n}`
      say(ckey, 'heading', heading)
    }
    const label = t(ch.label) || `Part ${n}`
    say(ckey, 'label', label)
    const intro = t(ch.intro)
    say(ckey, 'intro', intro)

    ;(ch.components ?? []).forEach((c, k) => {
      const key = `${ci}:${k}`
      const holdsParts = PART_TYPES.includes(c?.type) || (c?.type === 'file_card' && (c.part_ids ?? []).length > 0)
      const r = holdsParts ? partRange(c.part_ids) : null
      const keep = (type, data) => {
        comps.push({ type, data, key, pos: r?.pos ?? null })
        if (r?.pos) used.push(...r.pos.map((p) => parts[p].id))
      }
      const fail = (reason) => {
        dropped.push({ key, chapter: n, type: c?.type ?? null, reason })
        if (r?.pos) {
          comps.push(proseOf(r.pos))
          used.push(...r.pos.map((p) => parts[p].id))
        }
      }
      if (r?.reason) {
        problems.push(`chapter ${n} component ${k + 1} (${c.type}): ${r.reason}`)
        dropped.push({ key, chapter: n, type: c.type, reason: r.reason })
        return
      }
      if (drop.has(key)) return fail('it still failed the checks after the repair')
      if (c.type !== 'prose' && ++designed > maxComponents) return fail(`over the limit of ${maxComponents} designed components`)
      const fromParts = (builder, seg = {}) => buildFromParts(builder, r.pos.map((p) => parts[p]), seg, md)

      switch (c.type) {
        case 'prose':
          return keep('prose', proseOf(r.pos).data)
        case 'phone_ring_sim': {
          const states = c.states ?? []
          const b = fromParts('phone_ring_sim', { moment_actors: states.map((s) => STATE_ACTOR[s]) })
          if (!b.ok) return fail(b.reason)
          return keep('phone_ring_sim', { moments: b.data.moments.map((m, i) => ({ state: states[i], actor: m.actor, markdown: m.markdown })) })
        }
        case 'steps_checklist': {
          const b = fromParts('steps_checklist')
          if (!b.ok) return fail(b.reason)
          const titles = c.titles ?? []
          if (titles.length && titles.length !== b.data.steps.length) problems.push(`chapter ${n} steps_checklist: ${titles.length} titles for ${b.data.steps.length} steps (give one per step, or none)`)
          const stuck = new Map((c.stuck ?? []).filter((s) => t(s.cause) && t(s.fix)).map((s) => [s.step, s]))
          say(key, 'intro', c.intro)
          const steps = b.data.steps.map((s, i) => {
            const title = titles.length === b.data.steps.length ? t(titles[i]) : ''
            const h = stuck.get(i + 1)
            say(key, `step ${i + 1} title`, title)
            if (h) { say(key, `step ${i + 1} stuck cause`, h.cause); say(key, `step ${i + 1} stuck fix`, h.fix) }
            return { ...(title && { title }), markdown: s.markdown, ...(h && { stuck: { cause_markdown: t(h.cause), fix_markdown: t(h.fix) } }) }
          })
          return keep('steps_checklist', { ...(t(c.intro) && { intro: t(c.intro) }), steps })
        }
        case 'troubleshooting_picker': {
          const b = fromParts('troubleshooting_picker')
          if (!b.ok) return fail(b.reason)
          say(key, 'question', c.question)
          return keep('troubleshooting_picker', { ...(t(c.question) && { question: t(c.question) }), items: b.data.items })
        }
        case 'comparison_table': {
          const b = fromParts('comparison_table')
          if (!b.ok) return fail(b.reason)
          say(key, 'caption', c.caption)
          return keep('comparison_table', { ...(t(c.caption) && { caption: t(c.caption) }), markdown: b.data.markdown })
        }
        case 'faq': {
          const b = fromParts('faq_accordion')
          if (!b.ok) return fail(b.reason)
          return keep('faq', { items: b.data.items })
        }
        case 'file_card': {
          let code
          let language
          if (r) {
            const p = parts[r.pos[0]]
            if (r.pos.length !== 1 || p.type !== 'code') return fail('file_card part_ids must be exactly one code part')
            code = p.node.value
            language = fileLanguage(p.node.lang)
          } else {
            const s = snippetById.get(t(c.snippet_id))
            if (!s) return fail(`unknown snippet_id "${c.snippet_id}"`)
            const lines = String(s.code).split('\n').length
            const from = Number(c.line_from) || 0
            const to = Number(c.line_to) || 0
            if (from && !(from >= 1 && to >= from && to <= lines)) return fail(`line range ${from}–${to} is not inside ${s.id} (${lines} lines)`)
            code = from ? insertedCode(s, from, to) : s.code
            language = fileLanguage(s.language)
          }
          say(key, 'filename', c.filename)
          say(key, 'what', c.what)
          const preview = Number(c.preview_lines) || 0
          return keep('file_card', { filename: t(c.filename), language, what: t(c.what), code, ...(preview && { preview_lines: preview }) })
        }
        case 'journey_steps':
          ;(c.steps ?? []).forEach((s, i) => { say(key, `stage ${i + 1} title`, s.title); say(key, `stage ${i + 1} text`, s.text) })
          return keep('journey_steps', { steps: (c.steps ?? []).map((s) => ({ title: t(s.title), text_markdown: t(s.text) })), current: Number(c.current) || 0 })
        case 'approve_demo':
          for (const f of ['request', 'context', 'approve_label', 'approve_outcome', 'reject_label', 'reject_outcome']) say(key, f, c[f], true)
          return keep('approve_demo', {
            example: true, request: t(c.request), ...(t(c.context) && { context: t(c.context) }),
            approve: { label: t(c.approve_label), outcome_markdown: t(c.approve_outcome) },
            reject: { label: t(c.reject_label), outcome_markdown: t(c.reject_outcome) }
          })
        case 'route_compare':
          say(key, 'caption', c.caption)
          ;(c.routes ?? []).forEach((rt, i) => { say(key, `route ${i + 1} name`, rt.name); say(key, `route ${i + 1} best for`, rt.best_for); (rt.stops ?? []).forEach((s, j) => say(key, `route ${i + 1} stop ${j + 1}`, s)) })
          return keep('route_compare', { caption: t(c.caption), routes: (c.routes ?? []).map((rt) => ({ name: t(rt.name), ...(t(rt.best_for) && { best_for: t(rt.best_for) }), stops: (rt.stops ?? []).map(t), highlight: Boolean(rt.highlight) })) })
        case 'tool_picker': {
          say(key, 'question', c.question)
          const options = []
          for (const [i, o] of (c.options ?? []).entries()) {
            say(key, `option ${i + 1} label`, o.label)
            ;(o.steps ?? []).forEach((s, j) => say(key, `option ${i + 1} step ${j + 1}`, s))
            say(key, `option ${i + 1} done`, o.done)
            let file
            if (t(o.snippet_id)) {
              const s = snippetById.get(t(o.snippet_id))
              if (!s) problems.push(`chapter ${n} tool_picker option "${o.id}": unknown snippet_id "${o.snippet_id}"`)
              else file = { filename: `${t(o.id) || 'snippet'}.${EXT[fileLanguage(s.language)] ?? 'txt'}`, language: fileLanguage(s.language), what: `The code for ${t(o.label)}.`, code: s.code }
            }
            options.push({ id: t(o.id), label: t(o.label), steps: (o.steps ?? []).map((s) => ({ markdown: t(s) })), ...(file && { file }), ...(t(o.done) && { done_markdown: t(o.done) }) })
          }
          return keep('tool_picker', { question: t(c.question), options })
        }
        default:
          return fail(`"${c?.type}" is not a component type`)
      }
    })
    return { id: ckey, number: n, label, heading, ...(intro && { intro_markdown: intro }), components: comps }
  })

  const coverage = checkCoverage(parts.map((p) => p.id), used)
  if (!coverage.passed) problems.push(...coverage.details)

  const h = plan?.hero ?? {}
  for (const f of ['agent', 'request', 'person', 'result']) say('hero', f, h[f], true)
  const accent = t(plan?.title_accent)
  if (!accent || !String(title).includes(accent) || accent.length > 60 || accent.split(/\s+/).length > 4) problems.push(`title_accent "${accent}" must be 1–4 words copied exactly from the title`)
  const states = []
  for (const s of plan?.status_states ?? []) {
    if (!states.some((x) => x.state === s.state) && Number.isInteger(s.chapter) && s.chapter >= 1 && s.chapter <= chapters.length) states.push({ state: s.state, chapter: `c${s.chapter}` })
  }
  if (states.length < 3) problems.push('status_states: give 3–5 different states in story order, each with an existing chapter number')
  const yourTurn = t(plan?.your_turn_title)
  say('your_turn', 'title', yourTurn)

  if (!coverage.passed || !chapters.length) return { guide: null, dropped, coverage, authored, problems, ids: new Map() }

  const guide = {
    version: 1,
    title_accent: accent && String(title).includes(accent) && accent.length <= 60 ? accent : fallbackAccent(title),
    hero: drop.has('hero') ? { ...GENERIC_HERO } : { example: true, agent: t(h.agent), request: t(h.request), person: t(h.person), decision: h.decision === 'rejected' ? 'rejected' : 'approved', result: t(h.result) },
    status_states: states.length >= 3 ? states : defaultStates(chapters.length),
    chapters,
    your_turn: { title: yourTurn && yourTurn.length <= 80 && !drop.has('your_turn') ? yourTurn : GENERIC_YOUR_TURN }
  }
  for (const ch of chapters) {
    if (drop.has(ch.id)) {
      if (authored.some((a) => a.key === ch.id && a.field === 'heading')) ch.heading = `Chapter ${ch.number}`
      ch.label = `Part ${ch.number}`
      delete ch.intro_markdown
    }
  }

  // The content schema: a bad hero gets the generic one; a bad component is dropped (its parts become prose).
  let errors = validateGuide(strip(finish(guide, md, parts)), { title })
  if (errors.some((e) => e.startsWith('/guide/hero'))) {
    problems.push(...errors.filter((e) => e.startsWith('/guide/hero')))
    guide.hero = { ...GENERIC_HERO }
    errors = validateGuide(strip(finish(guide, md, parts)), { title })
  }
  const bad = new Set(errors.map((e) => e.match(/^\/guide\/chapters\/(\d+)\/components\/(\d+)/)).filter(Boolean).map((m) => `${m[1]}:${m[2]}`))
  if (bad.size) {
    problems.push(...errors.slice(0, 8))
    for (const where of bad) {
      const [ci, k] = where.split(':').map(Number)
      const c = guide.chapters[ci].components[k]
      dropped.push({ key: c.key, chapter: ci + 1, type: c.type, reason: errors.find((e) => e.startsWith(`/guide/chapters/${ci}/components/${k}`)) })
      guide.chapters[ci].components[k] = c.pos ? proseOf(c.pos) : null
    }
    for (const ch of guide.chapters) ch.components = ch.components.filter(Boolean)
    errors = validateGuide(strip(finish(guide, md, parts)), { title })
  }
  if (errors.length) {
    problems.push(...errors.slice(0, 8))
    return { guide: null, dropped, coverage, authored, problems, ids: new Map() }
  }
  const ids = new Map()
  for (const ch of guide.chapters) for (const c of ch.components) if (c.key) ids.set(c.key, c.id)
  return { guide: strip(guide), dropped, coverage, authored, problems, ids }
}

/**
 * Neighbouring prose of a chapter becomes one component (its text: the exact slice from the first part to the
 * last), then components are numbered g1, g2, … in reading order. Returns the guide (changed in place).
 */
function finish(guide, md, parts) {
  const at = new Map(parts.map((p, i) => [p.id, i]))
  let g = 0
  for (const ch of guide.chapters) {
    const out = []
    for (const c of ch.components) {
      const last = out.at(-1)
      if (c.type === 'prose' && last?.type === 'prose' && at.get(c.data.part_ids[0]) === at.get(last.data.part_ids.at(-1)) + 1) {
        const ids = [...last.data.part_ids, ...c.data.part_ids]
        last.data = { markdown: md.slice(parts[at.get(ids[0])].start, parts[at.get(ids.at(-1))].end), part_ids: ids }
        last.pos = [...(last.pos ?? []), ...(c.pos ?? [])]
      } else out.push(c)
    }
    ch.components = out
    for (const c of out) c.id = `g${++g}`
  }
  return guide
}

/** The guide as the content format wants it: only type, id and data on each component. */
const strip = (guide) => ({ ...guide, chapters: guide.chapters.map((ch) => ({ ...ch, components: ch.components.map(({ type, id, data }) => ({ type, id, data })) })) })

/** Every part exactly once, in order. */
export function checkCoverage(all, used) {
  const details = []
  const seen = new Set()
  const dupes = used.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
  const missing = all.filter((id) => !seen.has(id))
  if (missing.length) details.push(`coverage: these parts are not used: ${missing.join(', ')}`)
  if (dupes.length) details.push(`coverage: these parts are used twice: ${[...new Set(dupes)].join(', ')}`)
  if (!missing.length && !dupes.length && used.some((id, i) => id !== all[i])) details.push(`coverage: the parts are not in the post's order (first out of place: ${used.find((id, i) => id !== all[i])})`)
  return { passed: details.length === 0, details }
}

function fallbackAccent(title) {
  const words = String(title).split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'-]{3,}$/.test(w))
  return words.at(-1) ?? String(title).split(/\s+/)[0]
}

/** waiting → ringing → approved → continuing spread over the chapters, when the plan's states can't be used. */
function defaultStates(n) {
  const s = ['waiting', 'ringing', 'approved', 'continuing']
  return s.map((state, i) => ({ state, chapter: `c${Math.min(n, 1 + Math.floor((i * n) / s.length))}` }))
}
