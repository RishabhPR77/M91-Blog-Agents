// The Writer only for major problems (2026-10-23): REVISE_BELOW_SCORE and "pass with notes", minor hard checks
// (no repair call, no revision, no block on approval), paragraphs split by code, attribution in common wording, and
// revisions that change only what was flagged. Fakes only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, outcomeOf, reviewSummaryLine } from '../src/reviewer/decide.js'
import { MINOR_HARD_CHECKS, majorProblems, minorProblems, creditsOutlet, runContentChecks, urlKey } from '../src/checks/content.js'
import { splitLongParagraphs, splitParagraph } from '../src/writer/paragraphs.js'
import { hardChecksPassed } from '../src/approval.js'
import { REVISE } from '../src/writer/prompts.js'
import { buildReviewerPrompt } from '../src/reviewer/prompts.js'
import { fakeConfig } from './helpers.js'
import { config, reviewAnswer, item, savedDraft, GOOD_MD } from './reviewer/fixtures.js'
import { GOOD_MD as WRITER_MD, CTA, ISSUE, config as writerConfig, brief, draftAnswer } from './writer/fixtures.js'

const cfg = config()
const passing = savedDraft().checks.results
const ctx = (over = {}) => ({ markdown: GOOD_MD, checkResults: passing, config: cfg, ...over })
const failed = (id, detail = 'x') => ({ id, severity: 'hard', passed: false, value: 1, detail })
const G = { passScoreMin: 80, passAreaMin: 6, reviseBelowScore: 70 }
const gatesOk = [{ id: 'a', passed: true }]
const areas = (n) => [{ id: 'simplicity', score: n }]

// ---------- the outcome ----------

test('settings: REVISE_BELOW_SCORE defaults to 70; a revision sees the full previous draft', () => {
  const c = fakeConfig()
  assert.equal(c.gates.reviseBelowScore, 70)
  assert.equal(c.writer.revisionInput, 'full')
  assert.equal(fakeConfig({ REVISE_BELOW_SCORE: '80' }).gates.reviseBelowScore, 80)
})

test('outcome: pass, notes (score 70–79, a low area, a minor check), revise (a failed gate or a score under 70)', () => {
  assert.equal(outcomeOf({ gates: gatesOk, areas: areas(9), total: 85 }, G), 'pass')
  assert.equal(outcomeOf({ gates: gatesOk, areas: areas(9), total: 72.5 }, G), 'notes', 'under PASS_SCORE_MIN, not under REVISE_BELOW_SCORE')
  assert.equal(outcomeOf({ gates: gatesOk, areas: areas(5), total: 85 }, G), 'notes', 'a low area is minor')
  assert.equal(outcomeOf({ gates: gatesOk, areas: areas(9), total: 85, minorChecks: ['paragraph_length: …'] }, G), 'notes')
  assert.equal(outcomeOf({ gates: gatesOk, areas: areas(9), total: 69.9 }, G), 'revise')
  assert.equal(outcomeOf({ gates: [{ id: 'a', passed: false }], areas: areas(10), total: 100 }, G), 'revise', 'a failed gate is major at any score')
  assert.equal(outcomeOf({ gates: gatesOk, areas: areas(9), total: 75 }, { ...G, reviseBelowScore: 80 }), 'revise', 'REVISE_BELOW_SCORE=80: the old rule for the score')
})

test('decide: a total in the 70s with every AI gate passed and simplicity 5 (like 8D57 v2) is a pass with notes that goes to you', () => {
  const answer = reviewAnswer({ scores: { simplicity: 5, structure: 5 }, feedback: [item({ severity: 'must' })] })
  const d = decide(answer, ctx())
  assert.ok(d.total >= 70 && d.total < 80, String(d.total))
  assert.equal(d.outcome, 'notes')
  assert.equal(d.pass, true, 'counts as a pass: the run ends waiting for your approval')
  assert.equal(d.route_hint, null, 'not sent to the Writer')
  assert.ok(d.feedback.every((f) => f.severity === 'should'), 'every item is "should fix"')
  assert.ok(d.feedback.some((f) => f.area === 'simplicity'), 'the low area is listed (here by the Reviewer itself, so code adds no duplicate)')
  assert.ok(d.feedback.some((f) => f.generated && f.area === 'structure'), 'a low area the Reviewer did not mention is added by code')
  assert.match(reviewSummaryLine(d), /^Score [\d.]+\/100 · pass with notes · gates \d+\/\d+ · \d+ should-fix items?$/)
})

test('decide: under REVISE_BELOW_SCORE, or a failed AI gate, the post goes back to the Writer as before', () => {
  const low = decide(reviewAnswer({ scores: { simplicity: 3, accuracy: 4, to_the_point: 4, answers_question: 5 } }), ctx())
  assert.ok(low.total < 70, String(low.total))
  assert.equal(low.outcome, 'revise')
  assert.equal(low.pass, false)
  assert.equal(low.route_hint, 'writer')
  const gate = decide(reviewAnswer({ gates: { no_invented_content: false } }), ctx())
  assert.equal(gate.outcome, 'revise')
  assert.equal(gate.route_hint, 'writer')
})

// ---------- minor hard checks ----------

test('minor hard checks: a long paragraph or sentence; every other hard check is major', () => {
  assert.deepEqual([...MINOR_HARD_CHECKS], ['paragraph_length', 'sentence_hard'])
  const results = [...passing, failed('paragraph_length', '1 paragraph(s) over 3 sentences'), failed('sentence_hard', '1 sentence(s) over 25 words')]
  assert.equal(majorProblems(results).length, 0)
  assert.equal(minorProblems(results).length, 2)
  assert.deepEqual(majorProblems([failed('links_alive', 'dead: x')]), ['links_alive: dead: x (value: 1)'])
})

test('decide: a minor hard check alone gives a pass with notes (the code gate passes, the item is listed); a major one fails the gate', () => {
  const minor = decide(reviewAnswer(), ctx({ checkResults: [...passing, failed('paragraph_length', '1 paragraph(s) over 3 sentences')] }))
  assert.equal(minor.outcome, 'notes')
  const gate = minor.gates.find((g) => g.id === 'checks_hard_passed')
  assert.equal(gate.passed, true)
  assert.match(gate.evidence, /^every major hard check passed; minor: paragraph_length/)
  assert.ok(minor.feedback.some((f) => f.generated && f.area === 'checks' && f.severity === 'should' && /paragraph_length/.test(f.problem)))
  const major = decide(reviewAnswer(), ctx({ checkResults: [...passing, failed('reading_post_hard', 'hard limit grade 8')] }))
  assert.equal(major.outcome, 'revise')
  assert.equal(major.gates.find((g) => g.id === 'checks_hard_passed').passed, false)
})

test('approval: a minor hard check never blocks Approve; a major one does; older drafts use hard_passed', () => {
  assert.equal(hardChecksPassed({ payload: { checks: { hard_passed: false, major_passed: true } } }), true)
  assert.equal(hardChecksPassed({ payload: { checks: { hard_passed: false, major_passed: false } } }), false)
  assert.equal(hardChecksPassed({ payload: { checks: { hard_passed: true } } }), true)
  assert.equal(hardChecksPassed({ payload: { checks: { hard_passed: false } } }), false)
})

test('content checks report major_passed: a post with only a long sentence passes it', () => {
  const long = 'This one sentence is made deliberately long so that it goes well over the hard limit of twenty five words that the checks use for every post we write.'
  const md = WRITER_MD.replace('Agent approval means your software stops', `${long} Agent approval means your software stops`)
  const r = runContentChecks({ draft: { title: 'How agent approval works with a phone call', post_markdown: md, tldr: draftAnswer().tldr, seo: draftAnswer().seo }, brief: brief(), config: writerConfig(), allowedUrls: new Set([CTA, ISSUE, 'https://m91.msg91.com/'].map(urlKey)) })
  assert.equal(r.results.find((x) => x.id === 'sentence_hard').passed, false)
  assert.equal(r.hard_passed, false)
  assert.equal(r.major_passed, r.results.filter((x) => x.severity === 'hard' && !MINOR_HARD_CHECKS.includes(x.id)).every((x) => x.passed))
})

// ---------- paragraphs split by code ----------

test('paragraphs: one over the limit is split at sentence ends into even groups, same words, same order', () => {
  const p4 = 'One is here. Two is here. Three is here. Four is here.'
  assert.deepEqual(splitParagraph(p4, 3), ['One is here. Two is here.', 'Three is here. Four is here.'])
  const p7 = 'A a. B b. C c. D d. E e. F f. G g.'
  assert.deepEqual(splitParagraph(p7, 3), ['A a. B b. C c.', 'D d. E e.', 'F f. G g.'])
  assert.equal(splitParagraph('One. Two. Three.', 3), null, 'within the limit')
  const md = `# T\n\n${p4}\n\n- One. Two. Three. Four.\n\n## H\n\n\`\`\`\nOne. Two. Three. Four.\n\`\`\`\n\n> One. Two. Three. Four.\n`
  const r = splitLongParagraphs(md, 3)
  assert.equal(r.markdown, md.replace(p4, 'One is here. Two is here.\n\nThree is here. Four is here.'), 'lists, code and quotes untouched')
  assert.deepEqual(r.fixes, ['split 1 paragraph(s) over 3 sentences'])
  assert.deepEqual(splitLongParagraphs(r.markdown, 3), { markdown: r.markdown, fixes: [] }, 'idempotent')
})

test('paragraphs: links stay whole (a URL with dots never splits); a paragraph over two lines is joined first', () => {
  const p = 'Read [the report](https://news.example.com/a.b.html). It says one thing.\nIt says another! Does it say more? Yes.'
  const r = splitLongParagraphs(`# T\n\n${p}\n`, 3)
  assert.equal(r.markdown, '# T\n\nRead [the report](https://news.example.com/a.b.html). It says one thing. It says another!\n\nDoes it say more? Yes.\n')
})

// ---------- attribution in common wording ----------

test('attribution: "reported by X", "X reported", "a report by X", "X\'s report", "according to X" all credit X; a bare mention does not', () => {
  const X = 'The Hacker News'
  for (const s of ['It was reported by The Hacker News.', 'The Hacker News reported that two agents…', 'A report by The Hacker News says…', "The Hacker News' report says…", 'According to [The Hacker News](https://x.example.com), two agents…', 'as reported by the hacker news']) assert.equal(creditsOutlet(s, X), true, s)
  assert.equal(creditsOutlet('The Hacker News is a website.', X), false)
  assert.equal(creditsOutlet('reported by someone else', X), false)
  assert.equal(creditsOutlet('anything', ''), false)
})

test('news_attribution check accepts "X reported"; its message names the accepted wordings', () => {
  const b = brief({ news: { is_news_based: true, outlet: 'The Hacker News', published_date: '2026-10-20', claim_in_own_words: 'x', source_url: 'https://thehackernews.com/a' } })
  const run = (md) => runContentChecks({ draft: { title: 'How agent approval works with a phone call', post_markdown: md, tldr: draftAnswer().tldr, seo: draftAnswer().seo }, brief: b, config: writerConfig(), allowedUrls: new Set([CTA, ISSUE, 'https://m91.msg91.com/', 'https://thehackernews.com/a'].map(urlKey)) }).results.find((x) => x.id === 'news_attribution')
  assert.equal(run(WRITER_MD.replace('Agent approval means', 'The Hacker News reported an incident. Agent approval means')).passed, true)
  const miss = run(WRITER_MD)
  assert.equal(miss.passed, false)
  assert.match(miss.detail, /"reported by The Hacker News", "The Hacker News reported" or "according to The Hacker News"/)
})

// ---------- prompts ----------

test('prompts: revisions change only what was flagged; the Reviewer accepts any clear attribution and keeps "must" for real problems', () => {
  assert.match(REVISE, /Change only the sentences the feedback quotes or names/)
  assert.match(REVISE, /Copy every other sentence, heading, link and attribution from PREVIOUS DRAFT word for word/)
  const p = buildReviewerPrompt(cfg)
  assert.match(p, /Any clear wording passes \("reported by X", "X reported", "a report by X", "according to X"\)/)
  assert.match(p, /Keep "must" for problems that make the post wrong, unsupported or misleading; wording, length and polish are "should"/)
})
