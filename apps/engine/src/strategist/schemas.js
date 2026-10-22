// The brief's strict JSON schema — exact shape from the Phase 3 brief, section 8 (+ Phase 3.5 fields).

import { BLOCK_TYPES } from '@m91/content'

const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const str = { type: 'string' }
const bool = { type: 'boolean' }
const arr = (items) => ({ type: 'array', items })
const urlItem = obj({ step: str, source_url: str })

export const strategist_brief = {
  name: 'strategist_brief',
  strict: true,
  schema: obj({
    post_type: { type: 'string', enum: ['pinned', 'rapid_response', 'story', 'question', 'tutorial'] },
    lead: obj({ kind: { type: 'string', enum: ['pinned', 'cluster', 'story', 'tutorial'] }, id: str }),
    why_today: str,
    titles: arr(str),
    keyword: str,
    supporting_keywords: arr(str),
    topic_group: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    reader: str,
    intent: { type: 'string', enum: ['learn', 'compare', 'fix', 'buy'] },
    format: { type: 'string', enum: ['guide', 'tutorial', 'comparison', 'checklist', 'myth_buster', 'explainer'] },
    angle: str,
    tone: obj({ source: { type: 'string', enum: ['style_notes', 'default'] }, profile_id: str, guidance: arr(str) }),
    outline: arr(obj({ heading: str, answer_first: str, points: arr(str), source_urls: arr(str) })),
    questions: arr(str),
    m91_facts_to_use: arr(obj({ fact: str, source_url: str })),
    claims_to_avoid: arr(str),
    story: obj({ use: bool, story_id: str, attribution_line: str, source_url: str, how_to_use: str }),
    tutorial: obj({ use: bool, tutorial_id: str, target: str, reader_outcome: str, steps: arr(urlItem), gaps: arr(str) }),
    news: obj({ is_news_based: bool, outlet: str, published_date: str, claim_in_own_words: str, source_url: str }),
    sources: arr(obj({ url: str, what_it_supports: str })),
    cta: obj({ text: str, url: str }),
    review_flags: arr({ type: 'string', enum: ['rapid-response', 'comparison'] }),
    notes_for_writer: arr(str),
    // Phase 3.5: block ideas (names from @m91/content) and AI-chosen links to published posts.
    interactive_ideas: arr(obj({ block_type: { type: 'string', enum: [...BLOCK_TYPES] }, why: str })),
    internal_links: arr(obj({ url: str, anchor_text: str, why: str }))
  })
}

/**
 * Phase 12: the brief of one roadmap slot. The same fields, plus slot_id (exactly the slot planned) and
 * terms_to_define (the technical words this post explains the first time; the knowledge map keeps them).
 */
export const strategist_brief_slot = {
  name: 'strategist_brief_slot',
  strict: true,
  schema: {
    ...strategist_brief.schema,
    required: [...strategist_brief.schema.required, 'slot_id', 'terms_to_define'],
    properties: { ...strategist_brief.schema.properties, slot_id: str, terms_to_define: arr(str) }
  }
}
