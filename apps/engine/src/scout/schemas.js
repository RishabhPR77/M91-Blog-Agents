// Strict JSON schemas for the Scout's calls — exact shapes from the Phase 2 brief, section 10.
// Each export is the full { name, strict, schema } object sent as `json_schema`.

const obj = (properties, extra = {}) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...extra })
const str = { type: 'string' }
const arr = (items) => ({ type: 'array', items })
const READER = { type: 'string', enum: ['developer', 'fintech_ops', 'oncall_engineer', 'founder', 'other'] }
const INTENT = { type: 'string', enum: ['learn', 'compare', 'fix', 'buy'] }
const GROUP = { type: 'integer', enum: [1, 2, 3, 4, 5] }
const factWithUrl = obj({ fact: str, source_url: str })

export const scout_m91_facts = {
  name: 'scout_m91_facts',
  strict: true,
  schema: obj(
    {
      can: arr({ $ref: '#/$defs/fact' }),
      cannot: arr({ $ref: '#/$defs/fact' }),
      integrations: arr(obj({ name: str, what_it_enables: str, source_url: str })),
      contradictions: arr(obj({ issue: str, source_urls: arr(str) }))
    },
    { $defs: { fact: factWithUrl } }
  )
}

/** Same as scout_m91_facts with `fact` inlined, for when the API rejects $defs/$ref (brief 10). */
export const scout_m91_facts_inline = {
  ...scout_m91_facts,
  schema: obj({
    can: arr(factWithUrl),
    cannot: arr(factWithUrl),
    integrations: scout_m91_facts.schema.properties.integrations,
    contradictions: scout_m91_facts.schema.properties.contradictions
  })
}

export const scout_questions = {
  name: 'scout_questions',
  strict: true,
  schema: obj({
    questions: arr(obj({
      question: str,
      source_url: str,
      source_type: { type: 'string', enum: ['search', 'reddit', 'stackoverflow', 'github', 'hackernews', 'competitor', 'docs', 'other'] },
      demand_evidence: str,
      date_seen: str,
      reader_type: READER,
      intent: INTENT,
      m91_help: str
    }))
  })
}

export const scout_stories = {
  name: 'scout_stories',
  strict: true,
  schema: obj({
    stories: arr(obj({
      title: str,
      summary: str,
      why_it_matters: str,
      source_url: str,
      source_name: str,
      published_date: str,
      attribution_line: str,
      topic_group: GROUP
    }))
  })
}

export const scout_tutorials = {
  name: 'scout_tutorials',
  strict: true,
  schema: obj({
    tutorials: arr(obj({
      title: str,
      target: str,
      reader_outcome: str,
      supporting_facts: arr(obj({ fact: str, source_url: str })),
      steps_outline: arr(obj({ step: str, source_url: str })),
      gaps: arr(str),
      topic_group: GROUP
    }))
  })
}

export const scout_clusters = {
  name: 'scout_clusters',
  strict: true,
  schema: obj({
    clusters: arr(obj({
      main_question: str,
      related_questions: arr(str),
      topic_group: GROUP,
      reader_type: READER,
      intent: INTENT,
      freshness: { type: 'string', enum: ['this_week', 'ongoing'] },
      demand: obj({ level: { type: 'string', enum: ['low', 'medium', 'high'] }, reason: str }),
      m91_fit: obj({ score: { type: 'integer', enum: [1, 2, 3, 4, 5] }, reason: str }),
      source_urls: arr(str)
    }))
  })
}

export const scout_style = {
  name: 'scout_style',
  strict: true,
  schema: obj({
    topic: str,
    based_on: arr(obj({ url: str, title: str, engagement_signal: str })),
    notes: obj({
      opening_pattern: str,
      sentence_length: str,
      paragraph_style: str,
      explanation_style: str,
      examples: str,
      headings: str,
      avoid: arr(str)
    })
  })
}

export const scout_sources = {
  name: 'scout_sources',
  strict: true,
  schema: obj({
    claims: arr(obj({
      claim: str,
      results: arr(obj({
        url: str,
        publisher: str,
        verdict: { type: 'string', enum: ['supports', 'contradicts', 'unclear'] },
        note: str
      }))
    }))
  })
}

// Phase 12: the focused Scout (one post of the roadmap).
export const scout_slot_questions = {
  name: 'scout_slot_questions',
  strict: true,
  schema: obj({
    main_question: str,
    related_questions: arr(obj({ question: str, source_url: str, demand_evidence: str })),
    demand: obj({ level: { type: 'string', enum: ['high', 'medium', 'low'] }, reason: str }),
    off_roadmap: arr(obj({ title_idea: str, question: str, stage: { type: 'integer', enum: [1, 2, 3, 4, 5] }, teaches: arr(str), evidence_url: str, demand_evidence: str }))
  })
}

export const scout_slot_sources = {
  name: 'scout_slot_sources',
  strict: true,
  schema: obj({
    sources: arr(obj({ url: str, publisher: str, what_it_covers: str, kind: { type: 'string', enum: ['docs', 'official', 'standard', 'publication', 'community'] } }))
  })
}

export const SCHEMAS = Object.freeze({ scout_m91_facts, scout_questions, scout_stories, scout_tutorials, scout_clusters, scout_style, scout_sources, scout_slot_questions, scout_slot_sources })
