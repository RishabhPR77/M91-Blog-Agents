// Code checks on every brief (Phase 3 brief, section 10): safe automatic fixes, then a full problem list.

import Ajv from 'ajv'
import { strategist_brief, strategist_brief_target } from './schemas.js'
import { STANDING_CLAIMS, DEFAULT_CTA_TEXT } from './prompts.js'
import { urlKey } from './inputs.js'
import { storyDateRule } from '../scout/checks.js'
import { isBlockType } from '@m91/content'
import { findSimilar, dedupeSettings } from '../dedupe.js'

// The brief's secondary keywords (the Writer uses every one at least once).
export const SUPPORTING_MIN = 8
export const SUPPORTING_MAX = 14

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(strategist_brief.schema)
const validateTarget = ajv.compile(strategist_brief_target.schema)

/** Schema check; rtlayer answers arrive as strings. Returns { value, errors }. */
export function validateBrief(content, { target = false } = {}) {
  let value = content
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content)
    } catch {
      return { value: null, errors: ['schema: the answer is not valid JSON'] }
    }
  }
  const check = target ? validateTarget : validate
  if (check(value)) return { value, errors: [] }
  return { value: null, errors: check.errors.slice(0, 8).map((e) => `schema: ${e.instancePath || '/'} ${e.message}`) }
}

// ---------- 10.1 automatic fixes ----------

function trimDeep(v) {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(trimDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimDeep(x)]))
  return v
}
const uniq = (xs) => {
  const seen = new Set()
  return xs.filter((x) => {
    const k = String(x).toLowerCase()
    if (!x || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Applies the safe fixes in place-free fashion. Returns { brief, fixes: [warning lines] }. */
export function autoFix(input, { config, inputs }) {
  const fixes = []
  const b = trimDeep(structuredClone(input))
  const hosts = config.scout.docsHosts
  if (inputs?.target && !Array.isArray(b.terms_to_define)) b.terms_to_define = []

  // http → https for M91 docs hosts, everywhere in the brief.
  const httpsFix = (u) => {
    if (typeof u !== 'string') return u
    try {
      const x = new URL(u)
      if (x.protocol === 'http:' && hosts.includes(x.hostname.toLowerCase())) {
        x.protocol = 'https:'
        fixes.push(`rewrote ${u} to https`)
        return x.toString()
      }
    } catch {}
    return u
  }
  b.outline = b.outline.map((s) => ({ ...s, source_urls: s.source_urls.map(httpsFix) }))
  b.sources = b.sources.map((s) => ({ ...s, url: httpsFix(s.url) }))
  b.m91_facts_to_use = b.m91_facts_to_use.map((f) => ({ ...f, source_url: httpsFix(f.source_url) }))
  b.story.source_url = httpsFix(b.story.source_url)
  b.news.source_url = httpsFix(b.news.source_url)
  b.tutorial.steps = b.tutorial.steps.map((s) => ({ ...s, source_url: httpsFix(s.source_url) }))

  // Links not in the inputs: a near-miss of an input link (case, "-" for "_", a trailing slash) is put back to that
  // link; any other source or outline link is left out. A model often re-spells a thread's URL, and asking it again
  // rarely helped: a run stopped on one such link (R-261113-1131-JTR8).
  if (inputs?.allowedUrls) {
    const resolve = linkResolver(inputs, config)
    const fix = (u, what) => {
      const r = resolve(u)
      if (r && r !== u) fixes.push(`${what} ${u} → ${r} (spelled as in the inputs)`)
      return r
    }
    b.sources = b.sources.flatMap((s) => {
      const r = fix(s.url, 'source')
      if (r) return [{ ...s, url: r }]
      fixes.push(`left out source ${s.url}: not in the inputs`)
      return []
    })
    b.outline = b.outline.map((s, i) => ({ ...s, source_urls: s.source_urls.flatMap((u) => {
      const r = fix(u, `outline[${i}] link`)
      if (r) return [r]
      fixes.push(`left out outline[${i}] link ${u}: not in the inputs`)
      return []
    }) }))
    // The rest keep an unknown link: their own checks name the problem (a fact, a story, a step).
    b.m91_facts_to_use = b.m91_facts_to_use.map((f) => ({ ...f, source_url: fix(f.source_url, 'M91 fact link') ?? f.source_url }))
    b.story.source_url = fix(b.story.source_url, 'story link') ?? b.story.source_url
    b.news.source_url = fix(b.news.source_url, 'news link') ?? b.news.source_url
    b.tutorial.steps = b.tutorial.steps.map((s) => ({ ...s, source_url: fix(s.source_url, 'tutorial step link') ?? s.source_url }))
  }

  // Standing claims, word for word.
  for (const claim of STANDING_CLAIMS) {
    if (!b.claims_to_avoid.includes(claim)) {
      b.claims_to_avoid.push(claim)
      fixes.push('added a missing standing claim to claims_to_avoid')
    }
  }

  // Review flags follow post type and topic group.
  const flags = new Set(b.review_flags.filter((f) => f === 'rapid-response' || f === 'comparison'))
  if (flags.size !== b.review_flags.length) fixes.push('removed unknown review_flags')
  if (b.post_type === 'rapid_response' && !flags.has('rapid-response')) { flags.add('rapid-response'); fixes.push('added review flag rapid-response') }
  if (b.post_type !== 'rapid_response' && flags.has('rapid-response')) { flags.delete('rapid-response'); fixes.push('removed review flag rapid-response (not a rapid-response post)') }
  if (b.topic_group === 5 && !flags.has('comparison')) { flags.add('comparison'); fixes.push('added review flag comparison (topic group 5)') }
  b.review_flags = [...flags]

  // CTA always from config.
  const ctaUrl = config.m91.ctaUrl ?? ''
  if (b.cta.url !== ctaUrl) { b.cta.url = ctaUrl; fixes.push('set cta.url from M91_CTA_URL') }
  if (!b.cta.text) { b.cta.text = DEFAULT_CTA_TEXT; fixes.push('filled the empty cta.text') }

  // Tone: style_notes must name a profile that is in the inputs.
  if (b.tone.source === 'style_notes' && !inputs.styleNotes.some((s) => s.profile_id === b.tone.profile_id)) {
    b.tone.source = 'default'
    b.tone.profile_id = config.content.defaultTone
    fixes.push('tone profile not in the inputs: switched to the default tone')
  }

  // Unused blocks are cleared.
  if (!b.story.use && (b.story.story_id || b.story.attribution_line || b.story.source_url || b.story.how_to_use)) {
    b.story = { use: false, story_id: '', attribution_line: '', source_url: '', how_to_use: '' }
    fixes.push('cleared story fields (story.use is false)')
  }
  if (!b.tutorial.use && (b.tutorial.tutorial_id || b.tutorial.target || b.tutorial.reader_outcome || b.tutorial.steps.length || b.tutorial.gaps.length)) {
    b.tutorial = { use: false, tutorial_id: '', target: '', reader_outcome: '', steps: [], gaps: [] }
    fixes.push('cleared tutorial fields (tutorial.use is false)')
  }
  if (!b.news.is_news_based && (b.news.outlet || b.news.published_date || b.news.claim_in_own_words || b.news.source_url)) {
    b.news = { is_news_based: false, outlet: '', published_date: '', claim_in_own_words: '', source_url: '' }
    fixes.push('cleared news fields (not news-based)')
  }

  // Duplicates.
  for (const key of ['titles', 'supporting_keywords', 'questions']) {
    const before = b[key].length
    b[key] = uniq(b[key])
    if (b[key].length !== before) fixes.push(`removed duplicate ${key}`)
  }
  // internal_links: with no published posts the list must be empty.
  if (!(inputs.publishedPosts?.length) && b.internal_links.length) {
    b.internal_links = []
    fixes.push('cleared internal_links (there are no published posts yet)')
  }
  return { brief: b, fixes }
}

/** A link's loose form: host without www, path in lower case without "-", "_", spaces or a trailing slash. */
function looseUrl(u) {
  try {
    const x = new URL(String(u).trim())
    let path = x.pathname
    try {
      path = decodeURIComponent(path)
    } catch {}
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${path.toLowerCase().replace(/[-_\s]+/g, '').replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** (url) → the input's spelling of that link, a near-miss's input link, or null when the inputs do not have it. */
export function linkResolver(inputs, config) {
  const keys = new Set(inputs.allowedUrls)
  if (config.m91?.ctaUrl) keys.add(urlKey(config.m91.ctaUrl))
  const byLoose = new Map()
  for (const k of keys) {
    const l = looseUrl(k)
    if (l && !byLoose.has(l)) byLoose.set(l, inputs.allowedSpelling?.get(k) ?? k)
  }
  return (u) => {
    if (!u) return u
    if (keys.has(urlKey(u))) return u
    return byLoose.get(looseUrl(u)) ?? null
  }
}

/**
 * The last step when the model's repairs did not fix a brief: every fix code can make safely, so a mechanical
 * problem never stops a run. Lists over their limit are cut; the story, news and tutorial fields are copied from
 * their records; M91 facts that are not in the facts record are left out; an empty why_today or answer_first is
 * filled. A problem that needs judgment (the lead, the outline, the keyword, a duplicate topic) is left for the
 * checks to report. Returns { brief, fixes }.
 */
export function salvageBrief(input, { config, inputs }) {
  const fixes = []
  const b = structuredClone(input)
  const st = config.strategist
  if (b.titles.length > 3) { b.titles = b.titles.slice(0, 3); fixes.push('kept the first 3 titles') }
  if (b.titles[0] && b.titles[0].length > st.titleMaxChars) {
    const i = b.titles.findIndex((t) => t.length <= st.titleMaxChars && !GENERIC_TITLE.some((re) => re.test(t)))
    if (i > 0) { [b.titles[0], b.titles[i]] = [b.titles[i], b.titles[0]]; fixes.push(`titles[0] too long: titles[${i}] put first`) }
  }
  if ((b.terms_to_define ?? []).length > 8) { b.terms_to_define = b.terms_to_define.slice(0, 8); fixes.push('kept 8 terms_to_define') }
  if (b.supporting_keywords.length > SUPPORTING_MAX) { b.supporting_keywords = b.supporting_keywords.slice(0, SUPPORTING_MAX); fixes.push(`kept ${SUPPORTING_MAX} supporting_keywords`) }
  const ideas = b.interactive_ideas.filter((x) => isBlockType(x.block_type) && x.why).slice(0, 4)
  if (ideas.length !== b.interactive_ideas.length) { b.interactive_ideas = ideas; fixes.push('left out interactive ideas with an unknown block or no reason (at most 4)') }
  const links = b.internal_links.filter((l) => inputs.publishedUrls?.has(urlKey(l.url)) && l.anchor_text).slice(0, 3)
  if (links.length !== b.internal_links.length) { b.internal_links = links; fixes.push('left out internal links that are not published posts (at most 3)') }

  // M91 facts: only those in the facts record.
  const factTexts = [...inputs.facts.can.map((f) => f.fact), ...inputs.facts.cannot.map((f) => f.fact), ...inputs.facts.integrations.map((f) => `${f.name} ${f.what_it_enables}`)]
  const facts = b.m91_facts_to_use.filter((f) => inputs.factUrls.has(urlKey(f.source_url)) && factTexts.some((t) => wordOverlap(f.fact, t) >= 0.6))
  const dropped = b.m91_facts_to_use.length - facts.length
  if (dropped) { b.m91_facts_to_use = facts; fixes.push(`left out ${dropped} M91 fact(s) not in the facts record`) }

  // Story: copied from its record, or dropped when it is not a story in the inputs.
  if (b.story.use) {
    const s = inputs.leadIndex.get(b.story.story_id)
    if (!s || s.kind !== 'story') { b.story = { use: false, story_id: '', attribution_line: '', source_url: '', how_to_use: '' }; fixes.push('story left out: not a story in the inputs') }
    else if (b.story.source_url !== s.record.payload.source_url || b.story.attribution_line !== s.record.payload.attribution_line) {
      b.story = { ...b.story, source_url: s.record.payload.source_url, attribution_line: s.record.payload.attribution_line }
      fixes.push('story source and attribution copied from the story record')
    }
  }
  // Rapid response: the news is the story's.
  const lead = inputs.leadIndex.get(b.lead.id)
  if (b.post_type === 'rapid_response' && lead?.kind === 'story' && urlKey(b.news.source_url) !== urlKey(lead.record.payload.source_url)) {
    b.news = { ...b.news, is_news_based: true, source_url: lead.record.payload.source_url }
    fixes.push("news.source_url set to the story's source URL")
  }
  // The weekly pick's hook: the news is the hook's.
  const hook = inputs.target?.weekly ? inputs.target.hook : null
  if (hook && (!b.news.is_news_based || urlKey(b.news.source_url) !== urlKey(hook.source_url))) {
    b.news = { is_news_based: true, outlet: hook.outlet ?? b.news.outlet ?? '', published_date: hook.published_date ?? b.news.published_date ?? '', claim_in_own_words: b.news.claim_in_own_words || hook.what_happened || hook.title || '', source_url: hook.source_url }
    fixes.push("news filled from the weekly pick's hook")
  }
  // Tutorial: only the lead's steps, every gap kept.
  if (b.tutorial.use) {
    const t = inputs.leadIndex.get(b.tutorial.tutorial_id)
    if (t?.kind === 'tutorial') {
      const leadSteps = t.record.payload.steps_outline ?? []
      const steps = b.tutorial.steps.filter((s) => leadSteps.some((l) => l.step === s.step && urlKey(l.source_url) === urlKey(s.source_url)))
      if (steps.length !== b.tutorial.steps.length && steps.length) { b.tutorial.steps = steps; fixes.push("left out tutorial steps that are not the lead's") }
      const gaps = (t.record.payload.gaps ?? []).filter((g) => !b.tutorial.gaps.includes(g))
      if (gaps.length) { b.tutorial.gaps = [...b.tutorial.gaps, ...gaps]; fixes.push(`added ${gaps.length} tutorial gap(s) from the lead`) }
    }
  }
  if (inputs.target && !inputs.target.timely && !String(b.why_today ?? '').trim() && inputs.target.why_now) { b.why_today = inputs.target.why_now; fixes.push("why_today taken from the pick's why_now") }
  b.outline = b.outline.map((s, i) => {
    if (s.answer_first) return s
    fixes.push(`outline[${i}].answer_first filled from its heading`)
    return { ...s, answer_first: `Answer "${s.heading}" directly in the first two sentences.` }
  })
  return { brief: b, fixes }
}

// ---------- 10.2 problems ----------

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'can', 'not', 'its', 'you', 'your', 'when', 'into', 'per', 'via', 'has', 'have', 'will', 'one', 'any', 'all'])
const tokens = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []

/** Share of the brief fact's words that appear in the reference text. */
export function wordOverlap(fact, reference) {
  const a = [...new Set(tokens(fact))]
  if (!a.length) return 0
  const b = new Set(tokens(reference))
  return a.filter((w) => b.has(w)).length / a.length
}

export const GENERIC_TITLE = [/^implementing\b/i, /^streamlining\b/i, /the importance of/i, /ultimate guide/i, /everything you need to know/i, /a comprehensive guide/i]
const KIND_FOR_TYPE = { pinned: 'pinned', rapid_response: 'story', story: 'story', question: 'cluster', tutorial: 'tutorial' }

/** Every URL the brief relies on, with where it appears. */
export function briefUrls(b) {
  const out = []
  b.outline.forEach((s, i) => s.source_urls.forEach((u) => out.push([`outline[${i}]`, u])))
  b.sources.forEach((s, i) => out.push([`sources[${i}]`, s.url]))
  b.m91_facts_to_use.forEach((f, i) => out.push([`m91_facts_to_use[${i}]`, f.source_url]))
  if (b.story.use) out.push(['story', b.story.source_url])
  if (b.news.is_news_based) out.push(['news', b.news.source_url])
  if (b.tutorial.use) b.tutorial.steps.forEach((s, i) => out.push([`tutorial.steps[${i}]`, s.source_url]))
  return out.filter(([, u]) => u)
}

/**
 * All problems that need a repair call. Async because of the Mem0 duplicate check.
 * @returns {Promise<string[]>}
 */
export async function findProblems(b, { config, inputs, store, excludeBriefId = null }) {
  const st = config.strategist
  const problems = []
  const P = (s) => problems.push(s)

  // Titles
  if (b.titles.length !== 3) P(`titles has ${b.titles.length} items; it must have exactly 3`)
  if (b.titles[0] && b.titles[0].length > st.titleMaxChars) P(`titles[0] is ${b.titles[0].length} characters; the limit is ${st.titleMaxChars}`)
  b.titles.forEach((t, i) => { if (GENERIC_TITLE.some((re) => re.test(t))) P(`titles[${i}] is generic ("${t}"); name the exact situation, tool or mistake`) })

  // A post already chosen (the weekly pick or a pinned topic) names its terms and says why this week.
  if (inputs.target && !inputs.target.timely) {
    if ((b.terms_to_define ?? []).length > 8) P(`terms_to_define has ${b.terms_to_define.length} items; at most 8`)
    if (!String(b.why_today ?? '').trim()) P('why_today must say why this post matters this week')
  }
  // The weekly pick's news hook: the brief opens with it, from exactly its source.
  if (inputs.target?.weekly && inputs.target.hook && (!b.news?.is_news_based || urlKey(b.news.source_url) !== urlKey(inputs.target.hook.source_url))) {
    P(`news must be filled from the hook in POST TO PLAN (is_news_based true, source_url ${inputs.target.hook.source_url})`)
  }

  // Lead
  const lead = inputs.leadIndex.get(b.lead.id)
  if (!lead) P(`lead.id '${b.lead.id}' does not exist in the inputs or is not open`)
  else if (lead.kind !== b.lead.kind) P(`lead.kind is '${b.lead.kind}' but '${b.lead.id}' is a ${lead.kind}`)
  if (KIND_FOR_TYPE[b.post_type] !== b.lead.kind) P(`post_type '${b.post_type}' needs a lead of kind '${KIND_FOR_TYPE[b.post_type]}', not '${b.lead.kind}'`)
  if (inputs.pinnedDue.length && b.post_type !== 'pinned') P(`a pinned topic is due (${inputs.pinnedDue[0].pinned_id}) but was not picked`)
  if (inputs.target?.timely && b.post_type !== 'rapid_response') P('a timely post must have post_type "rapid_response"')
  if (inputs.blockedGroup != null && b.topic_group === inputs.blockedGroup) P(`topic_group ${b.topic_group} is blocked (both of the 2 most recent briefs used it)`)
  if (lead?.kind === 'cluster' && lead.record.payload.update_candidate && !st.allowUpdateBriefs) P(`cluster '${b.lead.id}' is marked update_candidate and ALLOW_UPDATE_BRIEFS is false`)

  // Rapid response: recomputed from the story record.
  if (b.post_type === 'rapid_response' && lead?.kind === 'story') {
    const s = lead.record.payload
    // The timely lane: a card's story counts within TIMELY_WINDOW_DAYS (the window the card was found in).
    const timely = Boolean(inputs.target?.timely)
    const days = timely ? config.timely?.windowDays ?? config.scout.rapidResponseDays : config.scout.rapidResponseDays
    const rule = storyDateRule(s.published_date, { today: inputs.today, lookbackDays: Math.max(config.scout.storyLookbackDays, days), rapidDays: days })
    if (!rule.rapid) P(`story '${b.lead.id}' (published ${s.published_date}) is not within ${timely ? 'TIMELY_WINDOW_DAYS' : 'RAPID_RESPONSE_DAYS'} (${days})`)
    const n = b.news
    if (!n.is_news_based || !n.outlet || !n.published_date || !n.claim_in_own_words || !n.source_url) P('news must be filled for a rapid-response post (outlet, published_date, claim_in_own_words, source_url)')
    else if (urlKey(n.source_url) !== urlKey(s.source_url)) P(`news.source_url must be the story's source URL ${s.source_url}`)
  }

  // Story block must copy the story record exactly.
  if (b.story.use) {
    const s = inputs.leadIndex.get(b.story.story_id)
    if (!s || s.kind !== 'story') P(`story.story_id '${b.story.story_id}' is not a story in the inputs`)
    else {
      if (urlKey(b.story.source_url) !== urlKey(s.record.payload.source_url)) P(`story.source_url must be ${s.record.payload.source_url}`)
      if (b.story.attribution_line !== s.record.payload.attribution_line) P(`story.attribution_line must be copied exactly: "${s.record.payload.attribution_line}"`)
    }
  }

  // Tutorial: steps are a subset of the lead's steps; every gap kept.
  if (b.post_type === 'tutorial' && !b.tutorial.use) P('post_type is tutorial but tutorial.use is false')
  if (b.tutorial.use) {
    const t = inputs.leadIndex.get(b.tutorial.tutorial_id)
    if (!t || t.kind !== 'tutorial') P(`tutorial.tutorial_id '${b.tutorial.tutorial_id}' is not a tutorial lead in the inputs`)
    else {
      const leadSteps = t.record.payload.steps_outline ?? []
      b.tutorial.steps.forEach((s, i) => {
        if (!leadSteps.some((l) => l.step === s.step && urlKey(l.source_url) === urlKey(s.source_url))) P(`tutorial.steps[${i}] is not one of the tutorial lead's steps (text and URL must be copied exactly)`)
      })
      for (const gap of t.record.payload.gaps ?? []) if (!b.tutorial.gaps.includes(gap)) P(`tutorial gap missing: "${gap.slice(0, 80)}"`)
    }
  }

  // M91 facts: from the facts record only (URL in the record, wording overlap ≥ 0.6).
  const factTexts = [
    ...inputs.facts.can.map((f) => f.fact), ...inputs.facts.cannot.map((f) => f.fact),
    ...inputs.facts.integrations.map((f) => `${f.name} ${f.what_it_enables}`)
  ]
  b.m91_facts_to_use.forEach((f, i) => {
    if (!inputs.factUrls.has(urlKey(f.source_url))) P(`m91_facts_to_use[${i}] source ${f.source_url} is not a source in the m91_facts record`)
    if (!factTexts.some((t) => wordOverlap(f.fact, t) >= 0.6)) P(`m91_facts_to_use[${i}] ("${f.fact.slice(0, 60)}") does not match any M91 fact`)
  })

  // URL allowlist.
  const allowed = new Set(inputs.allowedUrls)
  if (config.m91.ctaUrl) allowed.add(urlKey(config.m91.ctaUrl))
  for (const [where, u] of briefUrls(b)) if (!allowed.has(urlKey(u))) P(`source URL ${u} (${where}) is not in the inputs`)
  if (b.cta.url && !allowed.has(urlKey(b.cta.url))) P(`cta.url ${b.cta.url} is not M91_CTA_URL`)

  if (!b.sources.length) P('sources is empty')

  // Outline
  const n = b.outline.length
  if (n < st.outlineMinSections || n > st.outlineMaxSections) P(`outline has ${n} sections; it must have ${st.outlineMinSections}–${st.outlineMaxSections}`)
  const q = b.outline.filter((s) => s.heading.endsWith('?')).length
  if (q < st.minQuestionHeadings) P(`only ${q} outline headings are questions ending with "?"; at least ${st.minQuestionHeadings} are needed`)
  b.outline.forEach((s, i) => { if (!s.answer_first) P(`outline[${i}].answer_first is empty`) })

  // Interactive ideas: known block names, at most 4.
  if (b.interactive_ideas.length > 4) P(`interactive_ideas has ${b.interactive_ideas.length} items; at most 4`)
  b.interactive_ideas.forEach((idea, i) => {
    if (!isBlockType(idea.block_type)) P(`interactive_ideas[${i}].block_type "${idea.block_type}" is not a known block type`)
    if (!idea.why) P(`interactive_ideas[${i}].why is empty`)
  })

  // Internal links: published posts only, at most 3.
  if (b.internal_links.length > 3) P(`internal_links has ${b.internal_links.length} items; at most 3`)
  b.internal_links.forEach((l, i) => {
    if (!inputs.publishedUrls?.has(urlKey(l.url))) P(`internal_links[${i}] ${l.url} is not a URL from PUBLISHED POSTS`)
    if (!l.anchor_text) P(`internal_links[${i}].anchor_text is empty`)
  })

  // Keywords
  if (!b.keyword) P('keyword is empty')
  // A long keyword must appear in the first 100 words, which pushes the opening above its reading grade (seen live).
  const kwWords = String(b.keyword ?? '').trim().split(/\s+/).filter(Boolean).length
  const kwMax = config?.strategist?.keywordMaxWords ?? 6
  if (kwWords > kwMax) P(`keyword "${b.keyword}" has ${kwWords} words; at most ${kwMax} (KEYWORD_MAX_WORDS): use the short phrase people search for, not a whole question`)
  if (b.supporting_keywords.length < SUPPORTING_MIN || b.supporting_keywords.length > SUPPORTING_MAX) P(`supporting_keywords has ${b.supporting_keywords.length} items; it must have ${SUPPORTING_MIN}–${SUPPORTING_MAX}`)

  // Duplicate of a past brief: in memory against the briefs the run already listed (Phase 9 A3), or a Mem0 search.
  if (b.titles[0] && store?.getRecords) {
    const { mode, threshold } = dedupeSettings(config)
    const hits = await findSimilar(store, `${b.titles[0]} — ${b.keyword}`, { types: ['brief'], mode, topK: 10 })
    const dup = hits.find((h) => typeof h.score === 'number' && h.score >= threshold && (h.briefId ?? h.payload?.brief_id) !== excludeBriefId && h.status !== 'superseded')
    if (dup) P(`This topic is already covered by ${dup.briefId ?? dup.payload?.brief_id}: pick a different lead.`)
  }

  return problems
}
