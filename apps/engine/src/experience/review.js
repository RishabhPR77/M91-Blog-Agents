// What the Reviewer sees of a guide (Phase 10, C4): the design with the Designer's own text, and the Writer's
// text replaced by a pointer ("from POST"), so the message stays small and the two kinds of text stay apart.

const FROM_POST = '(the Writer\'s text, see POST)'

/** The guide for the Reviewer's GUIDE section. */
export function guideForReviewer(guide) {
  if (!guide) return null
  const comp = ({ type, data: d }) => {
    switch (type) {
      case 'prose': return { type, writer_parts: d.part_ids?.length ? `${d.part_ids[0]}–${d.part_ids.at(-1)}` : FROM_POST }
      case 'phone_ring_sim': return { type, states: d.moments.map((m) => m.state), moments: FROM_POST }
      case 'steps_checklist': return { type, intro: d.intro ?? '', steps: d.steps.map((s) => ({ title: s.title ?? '', text: FROM_POST, ...(s.stuck && { stuck_here: s.stuck }) })) }
      case 'troubleshooting_picker': return { type, question: d.question ?? '', problems: FROM_POST }
      case 'faq': return { type, questions: FROM_POST }
      case 'comparison_table': return { type, caption: d.caption ?? '', table: FROM_POST }
      case 'file_card': return { type, filename: d.filename, what: d.what, code: '(exact code from POST or a snippet)' }
      case 'tool_picker': return { type, question: d.question, options: d.options.map((o) => ({ label: o.label, steps: o.steps.map((s) => s.markdown), done: o.done_markdown ?? '', ...(o.file && { file: o.file.filename }) })) }
      default: return { type, ...d }
    }
  }
  return {
    note: 'Text the Experience Designer wrote is shown here; the Writer\'s text is only pointed to. Fields marked example are made-up example data (shown as "Example").',
    title_accent: guide.title_accent,
    hero: guide.hero,
    status_states: guide.status_states,
    chapters: guide.chapters.map((c) => ({ number: c.number, label: c.label, heading: c.heading, ...(c.intro_markdown && { intro: c.intro_markdown }), components: c.components.map(comp) })),
    your_turn: guide.your_turn.title
  }
}

/** Every piece of text the Designer wrote, one per line (so feedback quotes from the guide can be found). */
export function guideText(guide) {
  if (!guide) return ''
  const out = [guide.hero?.agent, guide.hero?.request, guide.hero?.person, guide.hero?.result, guide.your_turn?.title]
  for (const c of guide.chapters) {
    out.push(c.label, c.heading, c.intro_markdown)
    for (const { type, data: d } of c.components) {
      if (type === 'journey_steps') for (const s of d.steps) out.push(s.title, s.text_markdown)
      if (type === 'approve_demo') out.push(d.request, d.context, d.approve.label, d.approve.outcome_markdown, d.reject.label, d.reject.outcome_markdown)
      if (type === 'route_compare') { out.push(d.caption); for (const r of d.routes) out.push(r.name, r.best_for, ...r.stops) }
      if (type === 'steps_checklist') { out.push(d.intro); for (const s of d.steps) out.push(s.title, s.stuck?.cause_markdown, s.stuck?.fix_markdown) }
      if (type === 'tool_picker') { out.push(d.question); for (const o of d.options) out.push(o.label, ...o.steps.map((s) => s.markdown), o.done_markdown) }
      if (type === 'file_card') out.push(d.filename, d.what)
      if (type === 'troubleshooting_picker') out.push(d.question)
      if (type === 'comparison_table') out.push(d.caption)
    }
  }
  return out.filter(Boolean).join('\n')
}
