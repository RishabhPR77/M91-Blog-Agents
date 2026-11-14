// The Agents page: what each agent does, the model it runs on, every setting that shapes it, and its instructions
// word for word, built by the same functions the engine uses when it runs. Values that are only known during a run
// (today's date, the brief's keyword, the topic group) are shown as ‹…›. No secrets: models, numbers and prompt text.
import { SCOUT_BASE, FACTS, QUESTIONS, STORIES, TIMELY, TUTORIALS, CLUSTERS, STYLE, SOURCES, WEEK_QUESTIONS, SLOT_QUESTIONS, SLOT_SOURCES } from './scout/prompts.js'
import { EDITOR } from './weekly/prompts.js'
import { buildPlanPrompt } from './strategist/prompts.js'
import { buildWriterPrompt, wordsAim } from './writer/prompts.js'
import { FACT_CHECK } from './writer/factcheck.js'
import { buildReviewerPrompt } from './reviewer/prompts.js'
import { weightsFor } from './reviewer/decide.js'
import { buildExperiencePrompt } from './experience/prompts.js'
import { buildPromoPrompt } from './promo/prompts.js'
import { SOURCE_PAGES_MAX, SOURCE_TEXT_MAX, DOCS_TEXT_MAX } from './writer/sources.js'

/** Fills {{name}} with values[name]; a value only known during a run is shown as ‹name›. */
export const fillForDisplay = (template, values = {}) => String(template).replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] !== undefined && values[k] !== null ? String(values[k]) : `‹${k.replace(/_/g, ' ')}›`))

const model = (c) => (c ? { service: c.service ?? null, model: c.model ?? null, delivery: c.delivery ?? null } : null)
const onOff = (v) => (v === false ? 'off' : 'on')
const S = (label, value, note) => ({ label, value: value === undefined || value === null ? '—' : String(value), ...(note && { note }) })

/** Every agent, in pipeline order, with { id, name, role, gets, gives, model, enabled, settings[], prompts[] }. */
export function agentsInfo(config) {
  const c = config.content
  const sc = config.scout
  const st = config.strategist
  const wc = config.writer
  const rc = config.reviewer
  const ec = config.editor ?? {}
  const design = config.designer?.enabled !== false
  const scoutValues = {
    today: '‹today›', story_lookback_days: sc.storyLookbackDays, rapid_response_days: sc.rapidResponseDays, window_days: config.timely?.windowDays,
    questions_per_group: sc.questionsPerGroup, days: ec.questionDays, questions_max: ec.questionsMax, competitors: (sc.competitors ?? []).join(', ')
  }
  const stub = { keyword: '‹the brief’s main keyword›', titles: [] }
  const weights = weightsFor(design)

  return [
    {
      id: 'editor', name: 'Editor', role: 'Picks the one post worth writing this week.',
      gets: "This week's questions people asked, this week's news, what M91 can newly do, M91's integrations, pinned topics, and the live guides and recent posts (so it never repeats one).",
      gives: 'One pick: the title, the question, the format, the angle, why now, and the news hook if there is one.',
      model: model(config.editor), enabled: true,
      settings: [S('Candidates it weighs', ec.candidates), S('Signals each pick needs at least', ec.minEvidence), S('Questions looked at', `${ec.questionsMax ?? '—'} from the last ${ec.questionDays ?? '—'} days`), S('Repeat check', `similarity ${ec.similarity ?? '—'} against live guides and recent posts`)],
      prompts: [{ title: 'Instructions', text: fillForDisplay(EDITOR, { today: '‹today›', candidates: ec.candidates, min_evidence: ec.minEvidence }) }]
    },
    {
      id: 'scout', name: 'Scout', role: 'Researches with web search: news, real questions, sources and M91 facts.',
      gets: "M91's docs, the topic groups, and the editor's pick (for the research about this post).",
      gives: "M91 facts (from the docs only), this week's news, real questions, sources for the post, and tutorial steps for a tutorial.",
      model: model(sc), enabled: true,
      settings: [S('Research calls are sent', sc.researchDelivery), S('Most AI calls in one research run', sc.maxCalls), S('Topic groups', (sc.questionGroups ?? []).length), S('Questions per group', sc.questionsPerGroup), S('Stories from the last', `${sc.storyLookbackDays} days`), S('Rapid-response window', `${sc.rapidResponseDays} days`), S('M91 docs pages read', `up to ${sc.docsMaxPages} (${sc.docsMaxChars} characters)`)],
      prompts: [
        ['Base instructions (every task)', SCOUT_BASE], ["This week's news", TIMELY], ['What people asked this week', WEEK_QUESTIONS], ['Questions about this post', SLOT_QUESTIONS], ['Sources for this post', SLOT_SOURCES],
        ['M91 facts from the docs', FACTS], ['Tutorial ideas', TUTORIALS], ['Questions people ask (by topic group)', QUESTIONS], ['Recent public stories', STORIES], ['Grouping the questions into post ideas', CLUSTERS], ['How popular articles are written', STYLE], ['Sources for claims the Reviewer flagged', SOURCES]
      ].map(([title, t]) => ({ title, text: fillForDisplay(t, scoutValues) }))
    },
    {
      id: 'strategist', name: 'Strategist', role: 'Plans the post: the brief the Writer follows.',
      gets: "The editor's pick, the Scout's questions and sources, M91 facts, what readers already learned, lessons from past reviews.",
      gives: 'A brief: titles, keyword and supporting keywords, reader, angle, outline with answer-first lines, questions, M91 facts to use, claims to avoid, sources, CTA. Code checks it, fixes what it can and asks the model for one repair.',
      model: model(st), enabled: true,
      settings: [S('Repairs', st.maxRepairs), S('Title at most', `${st.titleMaxChars} characters`), S('Keyword at most', `${st.keywordMaxWords} words`), S('Outline', `${st.outlineMinSections}–${st.outlineMaxSections} sections, at least ${st.minQuestionHeadings} question headings`), S('Word target', `${c.targetWordsMin}–${c.targetWordsMax}`), S('Re-briefs per post', config.limits?.maxStrategistRebriefs)],
      prompts: [{ title: 'Instructions (a weekly post)', text: buildPlanPrompt(config, { target: { weekly: true }, blockedGroup: null, leastUsedGroups: ['‹chosen per run›'], lessons: ['‹lessons›'], today: '‹today›' }) }]
    },
    {
      id: 'writer', name: 'Writer', role: 'Writes the post from the brief and the evidence, then fixes what the checks and the fact check find.',
      gets: 'The brief, M91 FACTS, M91 DOCS TEXT (the docs pages it cites), SOURCE TEXT (the outside pages it cites), code snippets from the docs, tone notes, lessons, and on a revision the Reviewer\'s feedback.',
      gives: 'The post in Markdown, its TL;DR, SEO fields and context. Code then checks it; a serious problem gets one repair, checklist warnings one polish, and the fact check\'s corrections one fix, all in the same conversation.',
      model: model(wc), enabled: true,
      settings: [
        S('Word target', `${c.targetWordsMin}–${c.targetWordsMax}`, `aims for about ${c.targetWordsMin}–${wordsAim(c.targetWordsMin, c.targetWordsMax)}, never pads`),
        S('Reading grade', `intro ≤ ${c.readingGradeIntroMax}, post ≤ ${c.readingGradePostMax}`), S('Sentences', `about ${c.sentenceMaxWords} words, never over ${c.sentenceHardMaxWords}`), S('Paragraphs', `at most ${c.paragraphMaxSentences} sentences`),
        S('Repairs for serious problems', wc.maxRepairs), S('Polish pass (checklist warnings)', onOff(wc.polish)), S('Fact check before the review', onOff(wc.factCheck)), S('Revision gets', wc.revisionInput === 'full' ? 'the whole previous draft' : 'its summary'),
        S('Source pages read', `up to ${SOURCE_PAGES_MAX} (${SOURCE_TEXT_MAX} characters)`), S('M91 docs text', `up to ${DOCS_TEXT_MAX} characters`), S('Tone', c.defaultTone)
      ],
      prompts: [
        { title: 'Instructions (first draft)', text: buildWriterPrompt(config, stub, 'new', { previousContext: false, lessons: true }) },
        { title: 'Task line for a revision (replaces the first-draft task)', text: buildWriterPrompt(config, stub, 'revise', { lessons: true }).split('\n\n').slice(-1)[0] }
      ]
    },
    {
      id: 'factcheck', name: 'Fact check', role: "Checks every claim before the review, on the Reviewer's model, against the same evidence the Reviewer uses.",
      gets: 'The post, M91 FACTS, M91 DOCS TEXT, SOURCE TEXT and the brief\'s claims to avoid.',
      gives: 'Each sentence that the evidence does not support, with the corrected sentence. The Writer applies them; a fix that breaks a check is dropped.',
      model: model(rc), enabled: wc.factCheck !== false,
      settings: [S('On', onOff(wc.factCheck)), S('AI calls', 'one check, plus one Writer fix when something is wrong')],
      prompts: [{ title: 'Instructions', text: FACT_CHECK }]
    },
    {
      id: 'reviewer', name: 'Reviewer', role: 'Scores the post from a shared checklist and decides: pass, or back to the Writer.',
      gets: 'The post, the brief, the code check results, M91 FACTS, M91 DOCS TEXT, SOURCE TEXT, the allowed URLs and the previous review.',
      gives: 'Five gates (pass/fail), ten areas scored 0–10 from five criteria each, every "must" problem with a quote and a fix, and lessons for future posts. Code adds two gates of its own and computes the total.',
      model: model(rc), enabled: true,
      settings: [
        S('Pass mark', config.gates?.passScoreMin), S('Every area at least', config.gates?.passAreaMin), S('Sent back below', config.gates?.reviseBelowScore),
        S('Pages it may open besides SOURCE TEXT', rc.maxSourceChecks), S('"Should" items at most', rc.feedbackMaxItems, 'every "must" item is always listed'), S('Lessons per review', rc.lessonsPerReviewMax),
        S('Area weights', Object.entries(weights).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · '))
      ],
      prompts: [{ title: 'Instructions (gates, the checklist, feedback)', text: buildReviewerPrompt(config) }]
    },
    {
      id: 'designer', name: 'Experience Designer', role: 'Turns an approved draft into an interactive guide.',
      gets: 'The approved draft, the brief and M91 facts.', gives: 'A plan of interactive blocks, built by code from exact slices of the post.',
      model: model(config.designer), enabled: design,
      settings: [S('On', onOff(config.designer?.enabled)), S('Components at most', config.designer?.maxComponents)],
      prompts: [{ title: 'Instructions', text: buildExperiencePrompt(config) }]
    },
    {
      id: 'promo', name: 'Promo', role: 'Writes short promotion texts for an approved post.',
      gets: 'The approved post and its brief.', gives: 'A LinkedIn post, an X thread, a newsletter blurb, a video script and a community question.',
      model: model(config.promo), enabled: Boolean(config.promo?.enabled),
      settings: [S('On', onOff(config.promo?.enabled)), S('LinkedIn post at most', `${config.promo?.linkedinMaxChars} characters`)],
      prompts: [{ title: 'Instructions', text: buildPromoPrompt(config) }]
    }
  ]
}

/** How the agents work together: the order, the loop and what happens at the end. */
export function pipelineInfo(config) {
  const l = config.limits ?? {}
  const a = config.approval ?? {}
  return {
    order: ['Scout (news, questions)', 'Editor', 'Scout (this post)', 'Strategist', 'Writer', 'Checks', 'Polish', 'Fact check', 'Reviewer', 'Export', 'Publisher'],
    settings: [
      S('Rewrites after a review', l.maxWriterRevisions), S('Re-briefs', l.maxStrategistRebriefs), S('Extra Scout research', l.maxScoutRetries), S('AI rounds per post at most', l.maxAiRoundsPerPost),
      S('Approved automatically', a.autoApprove ? 'yes' : 'no, it waits for you'), S('When no version passes', a.bestOnFail ? 'the best version goes ahead' : 'the run stops'),
      S('After approval', config.publish?.target ?? config.publisher?.target ?? '—')
    ]
  }
}
