// The guide document (Phase 10, B1): an optional `guide` on a post. When it is there, the blog renders the post
// as an interactive guide: numbered chapters, each with components; otherwise the blocks or the Markdown.
//
// This is the RESOLVED form the Publisher writes: every text field holds its final text. Text the Writer wrote
// (prose, steps, questions, problems, tables) is copied in by code from the post's own parts; short interface
// text (labels, step titles, "Stuck here?" hints, scenario lines) comes from the Experience Designer. Fields
// that may hold made-up example data are marked with `example: true` and always shown as "Example".
//
// Parts of the page that are not chapter components:
// - hero_scene: guide.hero (the animated M91 scene at the top);
// - takeaways_log: the post's tldr;
// - status_rail: guide.status_states (the sticky status widget);
// - your_turn: guide.your_turn (the strip at the end).

export const GUIDE_STATES = Object.freeze(['waiting', 'ringing', 'approved', 'rejected', 'continuing'])
export const GUIDE_ACTORS = Object.freeze(['agent', 'm91', 'phone', 'human', 'software'])
export const FILE_LANGUAGES = Object.freeze(['bash', 'sh', 'console', 'powershell', 'json', 'js', 'javascript', 'ts', 'typescript', 'python', 'yaml', 'http', 'text'])

export const GUIDE_COMPONENT_TYPES = Object.freeze([
  'prose',
  'journey_steps',
  'phone_ring_sim',
  'approve_demo',
  'route_compare',
  'steps_checklist',
  'tool_picker',
  'file_card',
  'troubleshooting_picker',
  'comparison_table',
  'faq'
])

/** Components whose data may be made-up example data (always labelled "Example" on the page). */
export const EXAMPLE_COMPONENTS = Object.freeze(['approve_demo'])

export const CHAPTER_ID_RE = /^c[1-9][0-9]*$/
export const COMPONENT_ID_RE = /^g[1-9][0-9]*$/

const text = (max, min = 1) => ({ type: 'string', minLength: min, maxLength: max })
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties })
const arr = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems })

const fileCard = obj({
  filename: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' },
  language: { enum: [...FILE_LANGUAGES] },
  what: text(140),
  code: text(8000),
  preview_lines: { type: 'integer', minimum: 3, maximum: 40 }
}, ['filename', 'language', 'what', 'code'])

/** One data schema per component type (resolved form). Length limits are the reader-facing limits. */
export const GUIDE_COMPONENT_SCHEMAS = Object.freeze({
  prose: obj({ markdown: text(20000), part_ids: arr({ type: 'string' }, 0, 200) }, ['markdown']),
  journey_steps: obj({
    steps: arr(obj({ title: text(40), text_markdown: text(240) }), 3, 5),
    current: { type: 'integer', minimum: 0, maximum: 4 }
  }),
  phone_ring_sim: obj({
    moments: arr(obj({ state: { enum: [...GUIDE_STATES] }, actor: { enum: [...GUIDE_ACTORS] }, markdown: text(600) }), 3, 8)
  }),
  approve_demo: obj({
    example: { const: true },
    request: text(140),
    context: text(200),
    approve: obj({ label: text(24), outcome_markdown: text(300) }),
    reject: obj({ label: text(24), outcome_markdown: text(300) })
  }, ['example', 'request', 'approve', 'reject']),
  route_compare: obj({
    caption: text(140),
    routes: arr(obj({ name: text(40), best_for: text(120), stops: arr(text(40), 1, 8), highlight: { type: 'boolean' } }, ['name', 'stops']), 2, 4)
  }),
  steps_checklist: obj({
    intro: text(140),
    steps: arr(obj({
      title: text(80),
      markdown: text(3000),
      stuck: obj({ cause_markdown: text(300), fix_markdown: text(300) })
    }, ['markdown']), 2, 12)
  }, ['steps']),
  tool_picker: obj({
    question: text(80),
    options: arr(obj({
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,29}$' },
      label: text(30),
      steps: arr(obj({ markdown: text(400) }), 1, 8),
      file: fileCard,
      done_markdown: text(240)
    }, ['id', 'label', 'steps']), 2, 6)
  }),
  file_card: fileCard,
  troubleshooting_picker: obj({
    question: text(60),
    items: arr(obj({ problem_markdown: text(200), cause_markdown: text(400), fix_markdown: text(600) }), 2, 10)
  }, ['items']),
  comparison_table: obj({ caption: text(140), markdown: text(8000) }, ['markdown']),
  faq: obj({ items: arr(obj({ question_markdown: text(200), answer_markdown: text(3000) }), 1, 20) })
})

/** guide.hero: the M91 scene at the top of the page. Always an example. */
export const HERO_SCENE_SCHEMA = obj({
  example: { const: true },
  agent: text(30),
  request: text(100),
  person: text(40),
  decision: { enum: ['approved', 'rejected'] },
  result: text(100)
})

export const GUIDE_SCHEMA = obj({
  version: { const: 1 },
  title_accent: text(60),
  hero: { type: 'object' },
  status_states: arr(obj({ state: { enum: [...GUIDE_STATES] }, chapter: { type: 'string', pattern: CHAPTER_ID_RE.source } }), 3, 5),
  chapters: arr(obj({
    id: { type: 'string', pattern: CHAPTER_ID_RE.source },
    number: { type: 'integer', minimum: 1, maximum: 99 },
    label: text(40),
    heading: text(140),
    intro_markdown: text(600),
    components: arr(obj({
      type: { enum: [...GUIDE_COMPONENT_TYPES] },
      id: { type: 'string', pattern: COMPONENT_ID_RE.source },
      data: { type: 'object' }
    }), 0, 10)
  }, ['id', 'number', 'label', 'heading', 'components']), 1, 14),
  your_turn: obj({ title: text(80) })
})

/**
 * The checks a JSON schema cannot express (run after the schema): the accent is in the title, chapters are
 * numbered 1…n, ids are unique, each status state is used once and points at an existing chapter in order,
 * and a comparison table really is a table. `compile` builds a validator (ajv) for a schema.
 */
export function guideRuleErrors(guide, { title = '' } = {}) {
  const errors = []
  if (title && !String(title).includes(guide.title_accent)) errors.push(`/guide/title_accent "${guide.title_accent}" is not in the title`)
  const chapterIds = guide.chapters.map((c) => c.id)
  guide.chapters.forEach((c, i) => {
    if (c.number !== i + 1) errors.push(`/guide/chapters/${i}/number must be ${i + 1}`)
  })
  if (new Set(chapterIds).size !== chapterIds.length) errors.push('/guide/chapters ids must be unique')
  const componentIds = guide.chapters.flatMap((c) => c.components.map((x) => x.id))
  if (new Set(componentIds).size !== componentIds.length) errors.push('/guide/chapters component ids must be unique')
  const states = guide.status_states.map((s) => s.state)
  if (new Set(states).size !== states.length) errors.push('/guide/status_states each state may appear once')
  let last = -1
  guide.status_states.forEach((s, i) => {
    const at = chapterIds.indexOf(s.chapter)
    if (at < 0) errors.push(`/guide/status_states/${i}/chapter "${s.chapter}" is not a chapter`)
    else if (at < last) errors.push(`/guide/status_states/${i} must not point at an earlier chapter than the state before it`)
    else last = at
  })
  guide.chapters.forEach((c, i) => c.components.forEach((x, k) => {
    if (x.type === 'comparison_table' && !/^\s*\|.*\|\s*$/m.test(String(x.data?.markdown ?? ''))) errors.push(`/guide/chapters/${i}/components/${k}/data/markdown must be a Markdown table`)
    if (x.type === 'journey_steps' && Number(x.data?.current) >= (x.data?.steps?.length ?? 0)) errors.push(`/guide/chapters/${i}/components/${k}/data/current must point at a step`)
  }))
  return errors
}
