// Shared content checks (Phase 4 brief, section 9). Pure: draft + brief + context in, results out.
// Never changes the post. Reused by the Reviewer in Phase 5.
// Each result: { id, passed, severity: "hard" | "soft", value, detail }.

import { BANNED_PHRASES, FIRST_PERSON_PHRASES, HARD_CLAIM_PATTERNS, SOFT_CLAIM_WORDS, LEGAL_FRAMING_PHRASES, findPhrases, phraseRegex } from './phrases.js'
import { fleschKincaidGrade, sentences, words, sentenceStats } from './readability.js'

export const urlKey = (u) => String(u ?? '').trim().replace(/\/+$/, '').toLowerCase()
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9?]+/g, ' ').trim()
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
 * @param {string} [args.tutorialText]    tutorial source text that was sent to the Writer
 * @param {Map<string,string>} [args.linkStatuses]  urlKey → ok | blocked | dead | invalid (pre-checked)
 * @param {string[]} [args.schemaErrors]  validation errors from the schema check, if any
 * @returns {{ results: object[], hard_passed: boolean, word_count: number, reading: { intro_grade, post_grade }, parsed }}
 */
export function runContentChecks({ draft, brief, config, allowedUrls, tutorialText = '', linkStatuses = null, schemaErrors = [] }) {
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
  const hardGrade = c.readingGradePostMax + (c.readingGradeHardMargin ?? 2)
  R('reading_post_hard', postGrade !== null && postGrade <= hardGrade, 'hard', postGrade, `hard limit grade ${hardGrade}`)
  R('reading_post', postGrade !== null && postGrade <= c.readingGradePostMax, 'soft', postGrade, `target grade ${c.readingGradePostMax}`)
  R('reading_intro', introGrade !== null && introGrade <= c.readingGradeIntroMax, 'soft', introGrade, `TL;DR + first paragraph, target grade ${c.readingGradeIntroMax}`)
  const ss = sentenceStats(p.prose)
  R('sentence_length', ss.average <= 15 && ss.over === 0, 'soft', ss.average, `average ${ss.average} words; ${ss.over} sentence(s) over 25 words`)
  const allParas = p.sections.flatMap((s) => paragraphsOf(s.lines))
  const longParas = allParas.filter((x) => sentenceCount(x) > 3).length
  R('paragraph_length', longParas === 0, 'soft', longParas, 'paragraphs longer than 3 sentences')
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
  if (linkStatuses) {
    const dead = linkUrls.filter((u) => {
      const s = linkStatuses.get(urlKey(u))
      return s === 'dead' || s === 'invalid'
    })
    R('links_alive', dead.length === 0, 'hard', dead.length, dead.length ? `dead: ${dead.slice(0, 3).join(', ')}` : 'ok')
  } else R('links_alive', true, 'hard', 0, 'not checked')
  const outside = linkUrls.filter((u) => urlKey(u) !== urlKey(ctaUrl) && !(brief?.internal_links ?? []).some((l) => urlKey(l.url) === urlKey(u)))
  const docsOnly = isTutorial && outside.every((u) => {
    try {
      const host = new URL(u).hostname.toLowerCase()
      return (config.scout?.docsHosts ?? []).includes(host) || host === 'github.com'
    } catch {
      return false
    }
  })
  R('links_count', outside.length >= 2 || docsOnly, 'soft', outside.length, docsOnly ? 'tutorial relying on M91 docs' : 'distinct outside sources')
  const ctaOk = Boolean(ctaUrl) && Boolean(p.cta) && p.cta.lines.some((l) => [...l.matchAll(/\]\((\S+?)\)/g)].some((m) => urlKey(m[1]) === urlKey(ctaUrl)))
  R('cta', ctaOk, 'hard', ctaOk ? 1 : 0, p.cta ? (ctaUrl ? 'CTA link in "What to do next"' : 'M91_CTA_URL is not set') : 'no "What to do next" section')

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
    const ok = /reported by/i.test(md) && outlet && md.toLowerCase().includes(outlet.toLowerCase())
    R('news_attribution', ok, 'hard', ok ? 1 : 0, ok ? 'ok' : `"reported by" and "${outlet}" must both appear`)
  }

  // Tutorials
  if (isTutorial) {
    const src = '\n' + String(tutorialText).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n') + '\n'
    const bad = p.code
      .map((b, i) => ({ i, text: b.code.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') }))
      .filter((b) => b.text && !src.includes('\n' + b.text + '\n'))
    R('tutorial_code_verbatim', bad.length === 0, 'hard', bad.length, bad.length ? `code block(s) ${bad.map((b) => b.i + 1).join(', ')} not found exactly in TUTORIAL SOURCE TEXT` : `${p.code.length} code block(s) verified`)
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
  return { results, hard_passed, word_count: wordCount, reading: { intro_grade: introGrade, post_grade: postGrade }, parsed: p }
}

/** Phase 4 brief 6.6 conventions, checked only where they apply. */
export function blockFriendly(p, md, brief, isTutorial) {
  const out = []
  const ideas = (brief?.interactive_ideas ?? []).map((i) => i.block_type)
  const untagged = p.code.filter((b) => !b.lang).length
  out.push({ id: 'block_code_lang', passed: untagged === 0, value: untagged, detail: `${p.code.length} code block(s), ${untagged} without a language tag` })
  const html = (p.rawText.match(/<\/?[a-z][a-z0-9]*(\s[^>]*)?>/gi) ?? []).filter((t) => !/^<https?:/i.test(t))
  out.push({ id: 'block_no_html', passed: html.length === 0, value: html.length, detail: html.slice(0, 3).join(' ') || 'ok' })
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

/** One line per failed hard check, for the repair prompt. */
export function hardProblems(results) {
  return results.filter((r) => r.severity === 'hard' && !r.passed).map((r) => `${r.id}: ${r.detail}${r.value !== undefined && r.value !== '' ? ` (value: ${r.value})` : ''}`)
}
