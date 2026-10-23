// Fixes from the review of the first Phase 12 reviews: hard reading limits 8/7 with soft targets 7/6, the news source
// linked by code, and the Writer's prompt lines against invented examples and absolute claims. (The link checker's retry
// is tested in scout/checks.test.js.) Fakes only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runContentChecks, parseMarkdown, urlKey } from '../src/checks/content.js'
import { fleschKincaidGrade } from '../src/checks/readability.js'
import { linkNewsSource, newsSourcesOf } from '../src/writer/newslink.js'
import { autoFixDraft } from '../src/writer/index.js'
import { allowedUrlSet } from '../src/writer/inputs.js'
import { WRITER_BASE } from '../src/writer/prompts.js'
import { fakeConfig } from './helpers.js'
import { GOOD_MD, ISSUE, CTA, config, brief, draftAnswer } from './writer/fixtures.js'

const HN = 'https://thehackernews.com/2026/10/gpt-6-incident.html'
const check = (cfg, md, b = brief()) => runContentChecks({ draft: { title: 'How agent approval works with a phone call', post_markdown: md, tldr: draftAnswer().tldr }, brief: b, config: cfg, allowedUrls: new Set([CTA, ISSUE, HN, 'https://m91.msg91.com/'].map(urlKey)) })
const get = (r, id) => r.results.find((x) => x.id === id)

// ---------- 1. reading limits ----------

test('reading limits: the defaults are targets 7 and 6 (soft) with hard limits 8 and 7', () => {
  const c = fakeConfig()
  assert.deepEqual([c.content.readingGradePostMax, c.content.readingGradeIntroMax, c.content.readingGradeHardMargin], [7, 6, 1])
  const r = check(config(), GOOD_MD)
  assert.equal(get(r, 'reading_post_hard').detail, 'hard limit grade 8')
  assert.equal(get(r, 'reading_post').detail, 'target grade 7')
  assert.equal(get(r, 'reading_intro').detail, 'TL;DR + first paragraph, hard limit grade 7')
  assert.equal(get(r, 'reading_intro_target').detail, 'TL;DR + first paragraph, target grade 6')
  assert.equal(get(r, 'reading_intro').severity, 'hard')
  assert.equal(get(r, 'reading_intro_target').severity, 'soft')
})

test('reading limits: a grade between the target and the hard limit fails only the soft check; above the hard limit it fails the hard one', () => {
  const p = parseMarkdown(GOOD_MD)
  const postGrade = fleschKincaidGrade(p.prose)
  const introGrade = fleschKincaidGrade([...(p.tldr ?? []), p.firstParagraph].join('. '))
  // The target just under the fixture's grade, so the grade sits between the target and the hard limit (margin 1).
  const between = config({ READING_GRADE_POST_MAX: String(Math.max(1, Math.ceil(postGrade) - 1)), READING_GRADE_INTRO_MAX: String(Math.max(1, Math.ceil(introGrade) - 1)), READING_GRADE_HARD_MARGIN: '1' })
  const r = check(between, GOOD_MD)
  assert.equal(get(r, 'reading_post').passed, false, 'above the post target')
  assert.equal(get(r, 'reading_post_hard').passed, true, 'within the hard limit')
  assert.equal(get(r, 'reading_intro_target').passed, false, 'above the intro target')
  assert.equal(get(r, 'reading_intro').passed, true, 'within the hard limit')
  // The same text with no margin: the hard checks fail too.
  const none = check(config({ READING_GRADE_POST_MAX: String(Math.max(1, Math.ceil(postGrade) - 1)), READING_GRADE_INTRO_MAX: String(Math.max(1, Math.ceil(introGrade) - 1)), READING_GRADE_HARD_MARGIN: '0' }), GOOD_MD)
  assert.equal(get(none, 'reading_post_hard').passed, false)
  assert.equal(get(none, 'reading_intro').passed, false)
  // Two grades above the target is over the hard limit even with the margin.
  const far = check(config({ READING_GRADE_POST_MAX: String(Math.max(1, Math.ceil(postGrade) - 2)), READING_GRADE_INTRO_MAX: String(Math.max(1, Math.ceil(introGrade) - 2)), READING_GRADE_HARD_MARGIN: '1' }), GOOD_MD)
  if (Math.ceil(postGrade) > 2 && Math.ceil(introGrade) > 2) {
    assert.equal(get(far, 'reading_post_hard').passed, false)
    assert.equal(get(far, 'reading_intro').passed, false)
  }
})

// ---------- 2. the news source, linked by code ----------

const storyBrief = (over = {}) => brief({ story: { use: true, story_id: 'S-1', attribution_line: 'reported by The Hacker News', source_url: HN, how_to_use: 'x' }, news: { is_news_based: true, outlet: 'The Hacker News', published_date: '2026-10-20', claim_in_own_words: 'x', source_url: HN }, ...over })

test('news link: the outlet name after "reported by" becomes a link to the brief\'s source, once', () => {
  const md = '# T\n\nTwo agents weakened a check, reported by The Hacker News. The Hacker News also said more.\n\n## More\n\nThe Hacker News again.\n'
  const r = linkNewsSource(md, storyBrief())
  assert.equal(r.markdown, `# T\n\nTwo agents weakened a check, reported by [The Hacker News](${HN}). The Hacker News also said more.\n\n## More\n\nThe Hacker News again.\n`)
  assert.deepEqual(r.fixes, ['linked the news source (The Hacker News) at its first mention'])
  // Run again: already linked, nothing changes.
  assert.deepEqual(linkNewsSource(r.markdown, storyBrief()), { markdown: r.markdown, fixes: [] })
})

test('news link: headings, code, inline code and existing link text are skipped; no mention or no source leaves the post alone', () => {
  const md = ['# The Hacker News reports', '', '## What did The Hacker News say?', '', '```', 'The Hacker News', '```', '', 'Use `The Hacker News` as a label. See [The Hacker News guide](https://other.example.com/x).', '', 'Later, The Hacker News wrote it up.', ''].join('\n')
  const r = linkNewsSource(md, storyBrief())
  assert.ok(r.markdown.includes(`Later, [The Hacker News](${HN}) wrote it up.`), r.markdown)
  assert.ok(r.markdown.includes('# The Hacker News reports\n') && r.markdown.includes('## What did The Hacker News say?\n'))
  assert.ok(r.markdown.includes('```\nThe Hacker News\n```') && r.markdown.includes('`The Hacker News`') && r.markdown.includes('[The Hacker News guide](https://other.example.com/x)'))
  assert.equal([...r.markdown.matchAll(new RegExp(HN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length, 1)
  const none = '# T\n\nNo outlet is named here.\n'
  assert.deepEqual(linkNewsSource(none, storyBrief()), { markdown: none, fixes: [] })
  assert.deepEqual(linkNewsSource(md, brief()), { markdown: md, fixes: [] }, 'a post with no story or news is untouched')
})

test('news link: the source of a story and of news is linked each (two outlets, two links); the same URL only once', () => {
  const b = brief({ story: { use: true, story_id: 'S-1', attribution_line: 'reported by TechCrunch', source_url: 'https://techcrunch.example.com/a', how_to_use: 'x' }, news: { is_news_based: true, outlet: 'The Hacker News', published_date: '2026-10-20', claim_in_own_words: 'x', source_url: HN } })
  assert.deepEqual(newsSourcesOf(b), [{ url: 'https://techcrunch.example.com/a', outlet: 'TechCrunch' }, { url: HN, outlet: 'The Hacker News' }])
  const r = linkNewsSource('# T\n\nIt was reported by TechCrunch. The Hacker News agreed.\n', b)
  assert.ok(r.markdown.includes('reported by [TechCrunch](https://techcrunch.example.com/a). [The Hacker News](' + HN + ') agreed.'), r.markdown)
  assert.equal(r.fixes.length, 2)
  assert.equal(newsSourcesOf(storyBrief()).length, 1, 'the same URL once')
})

test('news link: part of the Writer\'s automatic fixes; the attribution checks and the allowed-link check still pass; the note is recorded', () => {
  const cfg = config()
  const b = storyBrief()
  const post = GOOD_MD.replace('Agent approval means your software stops', 'The incident was reported by The Hacker News, and agent approval means your software stops')
  const draft = { title: 'How agent approval works with a phone call', post_markdown: post, seo: draftAnswer().seo }
  const fixes = autoFixDraft(draft, { config: cfg, brief: b })
  assert.ok(fixes.includes('linked the news source (The Hacker News) at its first mention'), JSON.stringify(fixes))
  assert.ok(draft.post_markdown.includes(`reported by [The Hacker News](${HN})`))
  const { set } = allowedUrlSet(b, { ctaUrl: cfg.m91.ctaUrl, config: cfg })
  assert.ok(set.has(urlKey(HN)), 'the news URL is an allowed link')
  const r = runContentChecks({ draft: { ...draft, tldr: draftAnswer().tldr }, brief: b, config: cfg, allowedUrls: set })
  assert.equal(get(r, 'news_attribution').passed, true)
  assert.equal(get(r, 'story_attribution').passed, true)
  assert.equal(get(r, 'links_allowed').passed, true)
  assert.equal(get(r, 'link_text').passed, true, 'the link text names the source')
})

// ---------- 4. the Writer's prompt ----------

test('Writer prompt: link the news outlet, keep examples generic, no absolute claims', () => {
  assert.match(WRITER_BASE, /Link the outlet's name to its URL from ALLOWED URLS the first time you name it/)
  assert.match(WRITER_BASE, /Every outside claim carries its link\./)
  assert.match(WRITER_BASE, /Examples stay generic\. Never invent a person's name, an ID, a timestamp, a company, a note or a payload value/)
  assert.match(WRITER_BASE, /only when BRIEF m91_facts_to_use states it/)
  assert.match(WRITER_BASE, /No absolute claims\. Never write that a control makes something impossible or guaranteed: avoid "cannot", "can never", "always"/)
  assert.match(WRITER_BASE, /BRIEF claims_to_avoid always wins\./)
})
