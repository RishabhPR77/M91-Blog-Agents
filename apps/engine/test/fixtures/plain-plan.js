// A plain Experience Designer answer for any post (tests only): one chapter per H2, every part as prose, no
// designed components. Used where a test needs the Experience Designer to succeed without caring about the design.
import { parseParts, bodyMarkdown } from '../../src/designer/parts.js'

export function plainPlan(postMarkdown, title = '') {
  const { parts } = parseParts(bodyMarkdown(postMarkdown))
  const chapters = []
  let lead = []
  for (const p of parts) {
    if (p.type === 'heading' && p.depth === 2) chapters.push({ label: p.preview.replace(/^#+\s*/, '').slice(0, 40), heading_part_id: p.id, heading: '', intro: '', components: [] })
    else if (!chapters.length) lead.push(p.id)
    else {
      const c = chapters.at(-1).components
      if (c.at(-1)?.type === 'prose') c.at(-1).part_ids.push(p.id)
      else c.push({ type: 'prose', part_ids: [p.id] })
    }
  }
  // Text before the first H2 opens the guide as its own chapter (a written heading, no heading part).
  if (lead.length) chapters.unshift({ label: 'Start here', heading_part_id: '', heading: 'Start here', intro: '', components: [{ type: 'prose', part_ids: lead }] })
  return {
    title_accent: String(title).split(/\s+/).slice(-2).join(' '), hero: { agent: 'Your agent', request: 'Needs a decision', person: 'the person on call', decision: 'approved', result: 'Carries on' },
    status_states: ['waiting', 'ringing', 'approved'].map((state, i) => ({ state, chapter: Math.min(i + 1, chapters.length) })), chapters, your_turn_title: 'Try it on one risky step', notes: 'plain'
  }
}
