// Shared content checks (Phase 4 brief, section 9). Pure: draft + brief + context in, results out.
// Never changes the post. Reused by the Reviewer in Phase 5.
// Each result: { id, passed, severity: "hard" | "soft", value, detail }.

import { BANNED_PHRASES, FIRST_PERSON_PHRASES, HARD_CLAIM_PATTERNS, SOFT_CLAIM_WORDS, LEGAL_FRAMING_PHRASES, findPhrases, phraseRegex } from './phrases.js'
import { needsStartHere, START_HERE_RE } from '../timely/starthere.js'
import { fleschKincaidGrade, sentences, words, sentenceStats } from './readability.js'
import { normaliseCode } from '../writer/snippets.js'
import { docsLinksIn, M91_SITE_URL } from '../util/m91links.js'

export const urlKey = (u) => String(u ?? '').trim().replace(/\/+$/, '').toLowerCase()
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9?]+/g, ' ').trim()
// Link text that says nothing about the source (Phase 5 A2.3).
export const VAGUE_LINK_TEXT = Object.freeze(['source', 'sources', 'here', 'link', 'this', 'click here', 'read more'])
// Raw HTML tags in Markdown prose (autolinks like <https://…> are not HTML).
const htmlTags = (text) => (String(text).match(/<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/gi) ?? []).filter((t) => !/^<https?:/i.test(t))

/** URL key for the CTA auto-fix: ignores http/https, the host's letter case and a trailing slash. */
export function ctaVariantKey(u) {
  try {
    const x = new URL(String(u ?? '').trim())
    return `${x.hostname.toLowerCase()}${x.port ? ':' + x.port : ''}${x.pathname.replace(/\/+$/, '')}${x.search}${x.hash}`
  } catch {
    return null
  }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'not', 'does', 'how', 'what', 'your', 'you', 'its', 'into', 'about', 'docs', 'explain', 'there', 'their', 'which'])

// ---------- Markdown parsing ----------

/**
 * Splits Markdown into the parts the checks need. Prose excludes code blocks, URLs and headings.
 * @returns {{ h1: string[], h2: {text, index}[], h3: string[], sections: {heading, lines}[], code: {lang, code}[],
 *   links: {text, url}[], tldr: string[]|null, firstParagraph: string, cta: {lines}|null, prose: string, rawText: string, tables: number, numberedLists: number, lines: string[] }}
 */
export function parseMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = { h1: [], h2: [], h3: [], sections: [], code: [], links: [], tldr: null, firstParagraph: '', cta: null, prose: '', rawText: '', tables: 0, numberedLists: 0, lines }
  const textLines = [] // non-code, non-heading lines (prose candidates)
  let inCode = null
  let section = { heading: null, lines: [] }
  let afterH1 = false
  let firstParaLines = []
  let firstParaDone = false
  let inTldr = false
  let prevNumbered = false

  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/)
    if (inCode) {
      if (fence && !fence[1]) {
        out.code.push({ lang: inCode.lang, code: inCode.lines.join('\n') })
        inCode = null
      } else inCode.lines.push(line)
      continue
    }
    if (fence) {
      inCode = { lang: fence[1] || '', lines: [] }
      continue
    }
    let m
    if ((m = line.match(/^#\s+(.+?)\s*#*\s*$/))) {
      out.h1.push(m[1].trim())
      afterH1 = true
      continue
    }
    if ((m = line.match(/^##\s+(.+?)\s*#*\s*$/))) {
      out.h2.push({ text: m[1].trim(), index: out.h2.length })
      section = { heading: m[1].trim(), lines: [] }
      out.sections.push(section)
      inTldr = false
      if (afterH1) firstParaDone = true
      continue
    }
    if ((m = line.match(/^###\s+(.+?)\s*#*\s*$/))) {
      out.h3.push(m[1].trim())
      section.lines.push(line)
      continue
    }
    section.lines.push(line)
    if (/^\s*\*\*TL;DR\*\*/i.test(line) || /^\s*TL;DR:?\s*$/i.test(line)) {
      inTldr = true
      out.tldr = []
      if (afterH1) firstParaDone = true
      continue
    }
    if (inTldr) {
      const b = line.match(/^\s*[-*+]\s+(.+)$/)
      if (b) {
        out.tldr.push(b[1].trim())
        textLines.push(b[1])
        continue
      }
      if (line.trim() === '') {
        if (out.tldr.length) inTldr = false
        continue
      }
      inTldr = false
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|?\s*:?-{3,}/.test(line)) out.tables++
      textLines.push(line.replace(/\|/g, ' ').replace(/:?-{3,}:?/g, ' '))
      continue
    }
    const numbered = /^\s*\d+[.)]\s+/.test(line)
    if (numbered && !prevNumbered) out.numberedLists++
    if (line.trim() !== '' && !/^\s{2,}\S/.test(line)) prevNumbered = numbered
    if (afterH1 && !firstParaDone) {
      if (line.trim() === '') {
        if (firstParaLines.length) firstParaDone = true
      } else firstParaLines.push(line)
    }
    textLines.push(line)
  }
  if (inCode) out.code.push({ lang: inCode.lang, code: inCode.lines.join('\n') })

  const raw = textLines.join('\n')
  for (const m of raw.matchAll(/\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g)) out.links.push({ text: m[1], url: m[2] })
  const withoutMdLinks = raw.replace(/\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g, '$1')
  for (const m of withoutMdLinks.matchAll(/<?(https?:\/\/[^\s)<>]+)>?/g)) out.links.push({ text: '', url: m[1].replace(/[.,;:]+$/, '') })
  out.rawText = withoutMdLinks
  out.prose = withoutMdLinks
    .replace(/<?https?:\/\/[^\s)<>]+>?/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
  out.firstParagraph = firstParaLines.join(' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  const ctaSection = out.sections.find((s) => /what to do next/i.test(s.heading))
  out.cta = ctaSection ? { lines: ctaSection.lines } : null
  return out
}

/** Paragraphs of one section: blank-line separated blocks that are not lists, tables or H3s. */
function paragraphsOf(sectionLines) {
  const paras = []
  let cur = []
  const flush = () => {
    if (cur.length) paras.push(cur.join(' ').trim())
    cur = []
  }
  for (const l of sectionLines) {
    if (l.trim() === '' || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*\|/.test(l) || /^###/.test(l) || /^\s*```/.test(l)) flush()
    else cur.push(l)
  }
  flush()
  return paras.filter(Boolean)
}

const sentenceCount = (p) => sentences(p.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).length

// ---------- the checks ----------

/**
 * @param {object} args
 * @param {object} args.draft        writer_draft JSON (title, post_markdown, tldr, seo, …)
 * @param {object} args.brief        the brief
 * @param {object} args.config       loaded config (content, strategist, m91, scout)
 * @param {Set<string>} args.allowedUrls  urlKey()s of allowed URLs
 * @param {object[]} [args.snippets]      code snippets from the sources: the only code a post may contain
 * @param {string[]} [args.snippetErrors] [[SNIPPET:Sn]] problems found while replacing tokens
 * @param {string[]} [args.snippetRangeErrors] invalid [[SNIPPET:Sn:La-Lb]] line ranges
 * @param {object[]} [args.inserts] the line ranges inserted ({ id, from, to, code }); their code is allowed too
 * @param {Map<string,string>} [args.linkStatuses]  urlKey → ok | blocked | dead | invalid (pre-checked)
 * @param {string[]} [args.schemaErrors]  validation errors from the schema check, if any
 * @returns {{ results: object[], hard_passed: boolean, word_count: number, reading: { intro_grade, post_grade }, parsed }}
 */
export function runContentChecks({ draft, brief, config, allowedUrls, snippets = [], snippetErrors = [], snippetRangeErrors = [], inserts = [], linkStatuses = null, schemaErrors = [] }) {
  const results = []
  const R = (id, passed, severity, value, detail = '') => results.push({ id, passed: Boolean(passed), severity, value, detail })
  const md = draft?.post_markdown ?? ''
  const p = parseMarkdown(md)
  const c = config.content
  const isTutorial = brief?.post_type === 'tutorial' || brief?.tutorial?.use === true
  const ctaUrl = config.m91.ctaUrl ?? ''

  // Structure
  R('schema', schemaErrors.length === 0 && md.trim().length > 0, 'hard', schemaErrors.length, schemaErrors.slice(0, 3).join('; ') || (md.trim() ? 'ok' : 'post_markdown is empty'))
  R('h1', p.h1.length === 1 && p.h1[0] === String(draft?.title ?? '').trim(), 'hard', p.h1.length, p.h1.length === 1 ? (p.h1[0] === String(draft?.title ?? '').trim() ? 'ok' : 'H1 differs from title') : `${p.h1.length} H1 headings`)
  const tldrOk = Array.isArray(p.tldr) && p.tldr.length === 3 && Array.isArray(draft?.tldr) && draft.tldr.length === 3
  R('tldr', tldrOk, 'hard', p.tldr?.length ?? 0, p.tldr ? `${p.tldr.length} TL;DR bullets in the post, ${draft?.tldr?.length ?? 0} in "tldr"` : 'no TL;DR block')
  const minSections = config.strategist?.outlineMinSections ?? 4
  R('sections_min', p.h2.length >= minSections, 'hard', p.h2.length, `at least ${minSections} H2 sections`)
  const outline = (brief?.outline ?? []).map((s) => norm(s.heading))
  let found = 0
  let at = 0
  const h2n = p.h2.map((h) => norm(h.text))
  for (const h of outline) {
    const i = h2n.indexOf(h, at)
    if (i >= 0) {
      found++
      at = i + 1
    }
  }
  const outlineShare = outline.length ? Math.round((found / outline.length) * 100) / 100 : 1
  R('outline_match', outlineShare >= 0.8, 'soft', outlineShare, `${found} of ${outline.length} outline headings found in order`)

  // Length and readability
  const wordCount = words(p.prose).length
  const pct = (c.wordsHardMarginPct ?? 20) / 100
  const hardMin = Math.floor(c.targetWordsMin * (1 - pct))
  const hardMax = Math.ceil(c.targetWordsMax * (1 + pct))
  R('words_hard', wordCount >= hardMin && wordCount <= hardMax, 'hard', wordCount, `hard range ${hardMin}–${hardMax}`)
  R('words_target', wordCount >= c.targetWordsMin && wordCount <= c.targetWordsMax, 'soft', wordCount, `target ${c.targetWordsMin}–${c.targetWordsMax}`)
  const postGrade = fleschKincaidGrade(p.prose)
  const introText = [...(p.tldr ?? []), p.firstParagraph].join('. ')
  const introGrade = fleschKincaidGrade(introText)
  // The targets (READING_GRADE_POST_MAX 7, READING_GRADE_INTRO_MAX 6) are soft: the Reviewer sees them and scores
  // simplicity by them. The hard limits are the targets plus READING_GRADE_HARD_MARGIN (1): post 8, intro 7. A sentence
  // over SENTENCE_HARD_MAX_WORDS and a paragraph over PARAGRAPH_MAX_SENTENCES are hard too (the Writer's repair call
  // fixes them).
  const margin = c.readingGradeHardMargin ?? 1
  const hardGrade = c.readingGradePostMax + margin
  const hardIntro = c.readingGradeIntroMax + margin
  R('reading_post_hard', postGrade !== null && postGrade <= hardGrade, 'hard', postGrade, `hard limit grade ${hardGrade}`)
  R('reading_post', postGrade !== null && postGrade <= c.readingGradePostMax, 'soft', postGrade, `target grade ${c.readingGradePostMax}`)
  R('reading_intro', introGrade !== null && introGrade <= hardIntro, c.strictIntro === false ? 'soft' : 'hard', introGrade, `TL;DR + first paragraph, hard limit grade ${hardIntro}`)
  R('reading_intro_target', introGrade !== null && introGrade <= c.readingGradeIntroMax, 'soft', introGrade, `TL;DR + first paragraph, target grade ${c.readingGradeIntroMax}`)
  const softMax = c.sentenceMaxWords ?? 20
  const sentenceHard = c.sentenceHardMaxWords ?? 25
  const lens = sentences(p.prose).map((x) => ({ text: x, n: words(x).length }))
  const tooLong = lens.filter((x) => x.n > sentenceHard)
  const longish = lens.filter((x) => x.n > softMax && x.n <= sentenceHard)
  const quote = (x) => `"${x.text.split(/\s+/).slice(0, 8).join(' ')}…" (${x.n} words)`
  R('sentence_hard', tooLong.length === 0, 'hard', tooLong.length, tooLong.length ? `${tooLong.length} sentence(s) over ${sentenceHard} words: ${tooLong.slice(0, 3).map(quote).join(' | ')}` : `no sentence over ${sentenceHard} words`)
  R('sentence_length', longish.length === 0, 'soft', longish.length, longish.length ? `${longish.length} sentence(s) of ${softMax + 1}–${sentenceHard} words: ${longish.slice(0, 3).map(quote).join(' | ')}` : `every sentence at most ${softMax} words`)
  const allParas = p.sections.flatMap((s) => paragraphsOf(s.lines))
  const paraMax = c.paragraphMaxSentences ?? 3
  const longParas = allParas.filter((x) => sentenceCount(x) > paraMax)
  R('paragraph_length', longParas.length === 0, 'hard', longParas.length, longParas.length ? `${longParas.length} paragraph(s) over ${paraMax} sentences: ${longParas.slice(0, 2).map((x) => `"${x.split(/\s+/).slice(0, 8).join(' ')}…"`).join(' | ')}` : `every paragraph at most ${paraMax} sentences`)
  const answerFails = p.sections
    .filter((s) => !/what to do next/i.test(s.heading))
    .filter((s) => {
      const first = paragraphsOf(s.lines)[0]
      return !first || sentenceCount(first) > 2
    })
    .map((s) => s.heading)
  R('answer_first', answerFails.length === 0, 'soft', answerFails.length, answerFails.length ? `sections without a short answer first: ${answerFails.slice(0, 3).join(' | ')}` : 'ok')

  // Links
  const linkUrls = [...new Set(p.links.map((l) => l.url))]
  const notAllowed = linkUrls.filter((u) => !allowedUrls.has(urlKey(u)))
  R('links_allowed', notAllowed.length === 0, 'hard', notAllowed.length, notAllowed.length ? `not in ALLOWED URLS: ${notAllowed.slice(0, 3).join(', ')}` : 'ok')
  // No M91 docs links in posts (outside code): only outside sources and M91's main site.
  const docsLinks = docsLinksIn(md, config)
  R('no_docs_links', docsLinks.length === 0, 'hard', docsLinks.length, docsLinks.length ? `links to M91's docs (use ${M91_SITE_URL}): ${docsLinks.slice(0, 3).join(', ')}` : 'ok')
  if (linkStatuses) {
    const dead = linkUrls.filter((u) => {
      const s = linkStatuses.get(urlKey(u))
      return s === 'dead' || s === 'invalid'
    })
    R('links_alive', dead.length === 0, 'hard', dead.length, dead.length ? `dead: ${dead.slice(0, 3).join(', ')}` : 'ok')
  } else R('links_alive', true, 'hard', 0, 'not checked')
  const outside = linkUrls.filter((u) => urlKey(u) !== urlKey(ctaUrl) && urlKey(u) !== urlKey(M91_SITE_URL) && !(brief?.internal_links ?? []).some((l) => urlKey(l.url) === urlKey(u)))
  const docsOnly = isTutorial && outside.every((u) => {
    try {
      const host = new URL(u).hostname.toLowerCase()
      return (config.scout?.docsHosts ?? []).includes(host) || host === 'github.com'
    } catch {
      return false
    }
  })
  R('links_count', outside.length >= 2 || docsOnly, 'soft', outside.length, docsOnly ? 'tutorial relying on M91 docs' : 'distinct outside sources')
  // The last section must link to exactly M91_CTA_URL (near misses are fixed before the checks run).
  const last = p.sections[p.sections.length - 1]
  const ctaOk = Boolean(ctaUrl) && Boolean(last) && last.lines.some((l) => [...l.matchAll(/\]\((\S+?)\)/g)].some((m) => m[1] === ctaUrl))
  R('cta_exact', ctaOk, 'hard', ctaOk ? 1 : 0, !ctaUrl ? 'M91_CTA_URL is not set' : !last ? 'no H2 sections' : ctaOk ? `CTA link in "${last.heading}"` : `the last section ("${last.heading}") has no link to exactly M91_CTA_URL`)
  const vague = p.links.filter((l) => {
    const t = l.text.trim().toLowerCase().replace(/[.:!]+$/, '')
    return !t || VAGUE_LINK_TEXT.includes(t) || /^(https?:\/\/|www\.)/.test(t) || t === l.url.toLowerCase()
  })
  R('link_text', vague.length === 0, 'hard', vague.length, vague.length ? `link text must name the source: ${vague.slice(0, 3).map((l) => (l.text ? `[${l.text}](${l.url})` : `bare URL ${l.url}`)).join(', ')}` : 'ok')
  const html = htmlTags(p.rawText)
  R('raw_html', html.length === 0, 'hard', html.length, html.length ? `raw HTML outside code: ${html.slice(0, 3).join(' ')}` : 'ok')

  // Phrases and claims (prose + headings, never code)
  const phraseText = [p.rawText, ...p.h1, ...p.h2.map((h) => h.text), ...p.h3].join('\n')
  const banned = findPhrases(phraseText, BANNED_PHRASES)
  R('banned_phrases', banned.length === 0, 'hard', banned.length, banned.join(', ') || 'ok')
  const fp = findPhrases(phraseText, FIRST_PERSON_PHRASES)
  R('first_person', fp.length === 0, 'hard', fp.length, fp.join(', ') || 'ok')
  const hc = findPhrases(phraseText, HARD_CLAIM_PATTERNS)
  R('claims_hard', hc.length === 0, 'hard', hc.length, hc.join(', ') || 'ok')
  const soft = sentences(p.prose).filter((s) => /\bM91\b/.test(s) && SOFT_CLAIM_WORDS.some((w) => phraseRegex(w).test(s)))
  R('claims_soft', soft.length === 0, 'soft', soft.length, soft.slice(0, 3).join(' | '))

  // Keyword
  const kw = String(brief?.keyword ?? '').trim()
  const kwRe = kw ? new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+'), 'gi') : null
  const first100 = words(p.prose).slice(0, 100).join(' ')
  R('keyword_first_100', Boolean(kwRe) && kwRe.test(first100), 'soft', kw, 'main keyword in the first 100 prose words')
  if (kwRe) kwRe.lastIndex = 0
  const inTitle = kwRe ? [draft?.title, p.h1[0], String(draft?.seo?.slug_suggestion ?? '').replace(/-/g, ' ')].map((t) => new RegExp(kwRe.source, 'i').test(String(t ?? ''))) : [false, false, false]
  R('keyword_title_h1_slug', inTitle.every(Boolean), 'soft', inTitle.filter(Boolean).length, 'keyword in title, H1 and slug')
  const kwCount = kwRe ? (p.prose.match(new RegExp(kwRe.source, 'gi')) ?? []).length : 0
  R('keyword_count', kwCount >= 1 && kwCount <= 5, 'soft', kwCount, kwCount > 5 ? 'keyword stuffing' : 'times the main keyword appears')

  // SEO
  const tt = String(draft?.seo?.title_tag ?? '')
  const md2 = String(draft?.seo?.meta_description ?? '')
  R('seo_lengths', tt.length > 0 && tt.length <= 60 && md2.length > 0 && md2.length <= 155, 'hard', `${tt.length}/${md2.length}`, 'title_tag ≤ 60, meta_description ≤ 155')

  // Attribution
  if (brief?.story?.use) {
    const line = String(brief.story.attribution_line ?? '')
    const outlet = line.replace(/^(reported by|described (on|by)|according to|as reported by)\s+/i, '').trim()
    const ok = (line && md.toLowerCase().includes(line.toLowerCase())) || (outlet && md.toLowerCase().includes(outlet.toLowerCase()))
    R('story_attribution', ok, 'hard', ok ? 1 : 0, ok ? 'ok' : `attribution "${line}" not found`)
  }
  if (brief?.news?.is_news_based) {
    const outlet = String(brief.news.outlet ?? '')
    const ok = creditsOutlet(md, outlet)
    R('news_attribution', ok, 'hard', ok ? 1 : 0, ok ? 'ok' : `the news must be credited to ${outlet}, e.g. "reported by ${outlet}", "${outlet} reported" or "according to ${outlet}"`)
  }

  // The timely lane: a rapid-response post starts its body with the Start-here line (code puts it in).
  if (needsStartHere(brief, config)) {
    const ok = md.split('\n').some((l) => START_HERE_RE.test(l))
    R('start_here_line', ok, 'hard', ok ? 1 : 0, ok ? 'ok' : 'the "New to M91? Start here: …" line is missing (needs an approved Starter post)')
  }

  // Code: only inserted snippets, never code the AI wrote (every post).
  R('snippet_unknown', snippetErrors.length === 0, 'hard', snippetErrors.length, snippetErrors.slice(0, 3).join('; ') || 'ok')
  R('snippet_range_invalid', snippetRangeErrors.length === 0, 'hard', snippetRangeErrors.length, snippetRangeErrors.slice(0, 3).join('; ') || 'ok')
  // Allowed code: whole snippets and the exact line ranges that were inserted.
  const snippetCode = new Set([...snippets.map((s) => s.code), ...inserts.map((x) => x.code)].map(normaliseCode))
  const written = p.code.map((b, i) => ({ i, code: normaliseCode(b.code) })).filter((b) => b.code && !snippetCode.has(b.code))
  R('ai_written_code', written.length === 0, 'hard', written.length, written.length ? `code block(s) ${written.map((b) => b.i + 1).join(', ')} are not snippets from CODE SNIPPETS: use [[SNIPPET:Sn]] lines or describe the step in words` : `${p.code.length} code block(s), all snippets`)
  const known = [JSON.stringify(brief ?? {}), ...snippets.map((s) => s.code)].join('\n').toLowerCase()
  const inline = [...new Set([...p.rawText.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter(Boolean))]
  const unknownInline = inline.filter((x) => !known.includes(x.toLowerCase()))
  R('inline_code_known', unknownInline.length === 0, 'soft', unknownInline.length, unknownInline.length ? `inline code not in the brief or snippets: ${unknownInline.slice(0, 5).join(', ')}` : 'ok')

  // Tutorials
  if (isTutorial) {
    const lower = norm(md)
    const missing = (brief.tutorial?.gaps ?? []).filter((g) => {
      const keys = norm(g).split(' ').filter((w) => w.length >= 4 && !STOP.has(w))
      if (!keys.length) return false
      return keys.filter((k) => lower.includes(k)).length / keys.length < 0.5
    })
    R('tutorial_gaps', missing.length === 0, 'soft', missing.length, missing.length ? `gaps not mentioned: ${missing.slice(0, 2).join(' | ')}` : 'ok')
  }

  // Style
  const bangs = (p.prose.match(/!(?!=)/g) ?? []).length
  R('exclamations', bangs === 0, 'soft', bangs, 'target 0')
  const legal = findPhrases(phraseText, LEGAL_FRAMING_PHRASES)
  R('legal_framing', legal.length === 0, 'soft', legal.length, legal.join(', ') || 'ok')
  const ilinks = brief?.internal_links ?? []
  const unused = ilinks.filter((l) => !linkUrls.some((u) => urlKey(u) === urlKey(l.url)))
  R('internal_links_used', unused.length === 0, 'soft', ilinks.length - unused.length, `${ilinks.length - unused.length} of ${ilinks.length} internal links used`)

  // Block-friendly Markdown (one result per convention)
  for (const r of blockFriendly(p, md, brief, isTutorial)) R(r.id, r.passed, 'soft', r.value, r.detail)

  const hard_passed = results.filter((r) => r.severity === 'hard').every((r) => r.passed)
  // Minor hard checks do not send the post back to the Writer (no repair call, no revision); they are listed for you.
  const major_passed = results.filter((r) => r.severity === 'hard' && !MINOR_HARD_CHECKS.includes(r.id)).every((r) => r.passed)
  return { results, hard_passed, major_passed, word_count: wordCount, reading: { intro_grade: introGrade, post_grade: postGrade }, parsed: p }
}

/** Phase 4 brief 6.6 conventions, checked only where they apply. */
export function blockFriendly(p, md, brief, isTutorial) {
  const out = []
  const ideas = (brief?.interactive_ideas ?? []).map((i) => i.block_type)
  const untagged = p.code.filter((b) => !b.lang).length
  out.push({ id: 'block_code_lang', passed: untagged === 0, value: untagged, detail: `${p.code.length} code block(s), ${untagged} without a language tag` })
  if (isTutorial || ideas.includes('steps_checklist')) out.push({ id: 'block_steps_numbered', passed: p.numberedLists > 0, value: p.numberedLists, detail: 'steps as a numbered list' })
  if (brief?.format === 'comparison' || ideas.includes('comparison_table') || brief?.topic_group === 5) out.push({ id: 'block_comparison_table', passed: p.tables > 0, value: p.tables, detail: 'comparison as a Markdown table' })
  if (ideas.some((i) => ['phone_ring_sim', 'escalation_timeline', 'agent_terminal_replay'].includes(i))) out.push({ id: 'block_approval_sequence', passed: p.numberedLists > 0, value: p.numberedLists, detail: 'approval flow as a numbered sequence of moments' })
  if (/likely cause:/i.test(md) || ideas.includes('troubleshooting_picker')) {
    const lines = p.lines
    const causes = lines.map((l, i) => (/^\s*\*{0,2}likely cause:/i.test(l) ? i : -1)).filter((i) => i >= 0)
    const orphan = causes.filter((i) => {
      for (let j = i - 1; j >= 0; j--) {
        if (/^###\s/.test(lines[j])) return false
        if (/^##?\s/.test(lines[j])) return true
      }
      return true
    }).length
    out.push({ id: 'block_troubleshooting_h3', passed: causes.length > 0 && orphan === 0, value: causes.length, detail: causes.length ? `${orphan} "Likely cause:" line(s) without an H3 problem heading` : 'no "Likely cause:" / "Fix:" items found' })
  }
  const faq = p.sections.find((s) => /\bfaq\b|frequently asked/i.test(s.heading))
  if (faq || ideas.includes('faq_accordion')) {
    const qs = (faq?.lines ?? []).filter((l) => /^###\s/.test(l))
    const bad = qs.filter((l) => !/\?\s*$/.test(l)).length
    out.push({ id: 'block_faq_h3', passed: qs.length > 0 && bad === 0, value: qs.length, detail: qs.length ? `${bad} FAQ heading(s) not ending with "?"` : 'no FAQ questions as H3' })
  }
  if (ideas.includes('choice_explorer') || /\bif you (approve|reject)\b/i.test(md)) {
    const choiceParas = p.lines.filter((l) => /^\s*(\*\*)?if you (approve|reject)/i.test(l))
    const notBold = choiceParas.filter((l) => !/^\s*\*\*/.test(l)).length
    out.push({ id: 'block_choices_bold', passed: choiceParas.length > 0 && notBold === 0, value: choiceParas.length, detail: choiceParas.length ? `${notBold} choice paragraph(s) not starting in bold` : 'no "If you approve/reject" paragraphs' })
  }
  return out
}

/**
 * Hard checks whose failure is minor: a paragraph over PARAGRAPH_MAX_SENTENCES (code splits most of them) or a
 * sentence over SENTENCE_HARD_MAX_WORDS. They still fail hard_passed, but never call the Writer: a post that fails only
 * these goes to you with them listed as "should fix". Every other hard check is major.
 */
export const MINOR_HARD_CHECKS = Object.freeze(['paragraph_length', 'sentence_hard'])

const problemLine = (r) => `${r.id}: ${r.detail}${r.value !== undefined && r.value !== '' ? ` (value: ${r.value})` : ''}`

/**
 * Is the outlet credited as the source of a report, in any common wording? "reported by X", "as reported by X",
 * "X reported", "X reports", "a report by X", "X's report", "according to X" (link markup and case ignored).
 */
export function creditsOutlet(markdown, outlet) {
  const name = String(outlet ?? '').trim()
  if (!name) return false
  const text = String(markdown ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[’]/g, "'").replace(/\s+/g, ' ')
  const o = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return [
    `\\breported\\s+by\\s+(the\\s+)?${o}`,
    `\\b${o}\\s+(has\\s+)?(reported|reports|wrote|described)\\b`,
    `\\breport(s)?\\s+(by|from|in)\\s+(the\\s+)?${o}`,
    `\\b${o}'s?\\s+(report|article|story)\\b`,
    `\\baccording\\s+to\\s+(the\\s+)?${o}`
  ].some((re) => new RegExp(re, 'i').test(text))
}

/** One line per failed hard check, for the repair prompt. */
export function hardProblems(results) {
  return results.filter((r) => r.severity === 'hard' && !r.passed).map(problemLine)
}

/** Failed hard checks that are major (every hard check except MINOR_HARD_CHECKS). */
export function majorProblems(results) {
  return results.filter((r) => r.severity === 'hard' && !r.passed && !MINOR_HARD_CHECKS.includes(r.id)).map(problemLine)
}

/** Failed hard checks that are minor (MINOR_HARD_CHECKS). */
export function minorProblems(results) {
  return results.filter((r) => r.severity === 'hard' && !r.passed && MINOR_HARD_CHECKS.includes(r.id)).map(problemLine)
}
