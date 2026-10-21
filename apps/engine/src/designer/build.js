// The Designer's plan → post blocks (Phase 8, section 6.2). Pure code: every text field is a slice of the body
// Markdown taken from the parser's offsets; a segment that does not match its block type's pattern is dropped
// (its parts stay plain text). Parts no kept segment uses become rich_text blocks, in order.

import { validateBlock } from '@m91/content'
import { textOf } from './parts.js'

/** Block types the Designer may choose (section 3); rich_text is added by code. */
export const DESIGNER_BLOCK_TYPES = Object.freeze([
  'callout', 'steps_checklist', 'code_tabs', 'comparison_table', 'faq_accordion',
  'phone_ring_sim', 'escalation_timeline', 'agent_terminal_replay', 'choice_explorer', 'troubleshooting_picker'
])

export const TERMINAL_LANGUAGES = Object.freeze(['text', 'bash', 'console', 'log'])
export const ACTORS = Object.freeze(['agent', 'm91', 'phone', 'human', 'software'])
export const TONES = Object.freeze(['info', 'tip', 'warning'])

/** Readable tab names derived from a code block's language (code-generated, never AI text). */
const LANGUAGE_LABELS = {
  bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', zsh: 'Terminal', console: 'Terminal', powershell: 'PowerShell', ps1: 'PowerShell',
  js: 'JavaScript', javascript: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TypeScript',
  python: 'Python', py: 'Python', json: 'JSON', yaml: 'YAML', yml: 'YAML', http: 'HTTP', go: 'Go', java: 'Java', ruby: 'Ruby',
  php: 'PHP', csharp: 'C#', cs: 'C#', sql: 'SQL', html: 'HTML', css: 'CSS', text: 'Text', '': 'Text'
}
export function languageLabel(lang) {
  const key = String(lang ?? '').toLowerCase()
  return LANGUAGE_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Text')
}

// ---------- slicing helpers (offsets into the body Markdown) ----------

const span = (md, node) => md.slice(node.position.start.offset, node.position.end.offset)
const spanOf = (md, first, last) => md.slice(first.position.start.offset, last.position.end.offset)
/** A list item's content without its marker ("1. "): from its first child to its last child. */
const itemContent = (md, item) => (item.children?.length ? spanOf(md, item.children[0], item.children.at(-1)) : '')
/** A heading's text without its "### " marker. */
const headingInner = (md, h) => (h.children?.length ? spanOf(md, h.children[0], h.children.at(-1)) : '')
const isOrderedList = (p) => p.type === 'list' && p.ordered
const plain = (p) => textOf(p.node).replace(/\s+/g, ' ').trim()

// phone_ring_sim: the phone shows one state per actor (the same map as the blog's PhoneRingSim.astro). The
// moments must go through every state in this order, and an actor named at the start of a moment's text must be
// the moment's actor (m91 and phone both ring, so they count as one).
export const PHONE_STATES = Object.freeze({ agent: 'waiting', m91: 'ringing', phone: 'ringing', human: 'deciding', software: 'continuing' })
const STATE_ORDER = ['waiting', 'ringing', 'deciding', 'continuing']
const NAMED_ACTORS = [
  ['agent', /^(?:the |your |an? )?(?:ai )?agents?\b/i],
  ['m91', /^m91\b/i],
  ['phone', /^(?:the |your |a )?(?:on-call )?phones?\b/i],
  ['human', /^(?:the |a |an |your )?(?:person|human|approver|reviewer|someone|on-call (?:person|engineer))\b/i],
  ['software', /^(?:the |your )?(?:software|app|application|server|backend|code|system|service|workflow)\b/i]
]
/** The actor a moment's text starts with ("M91 rings…" → m91), or null when it names none. */
export function namedActor(text) {
  const t = String(text ?? '').replace(/^[\s*_`]+/, '')
  return NAMED_ACTORS.find(([, re]) => re.test(t))?.[0] ?? null
}
const sameActor = (a, b) => a === b || (PHONE_STATES[a] === 'ringing' && PHONE_STATES[b] === 'ringing')

class PatternError extends Error {}
const need = (ok, message) => {
  if (!ok) throw new PatternError(message)
}

// ---------- one builder per block type: (parts, segment, md) → data, or a PatternError ----------

const BUILDERS = {
  callout(parts, seg, md) {
    need(TONES.includes(seg.callout_tone), `callout needs a tone (info, tip or warning), got "${seg.callout_tone}"`)
    const oneQuote = parts.length === 1 && parts[0].type === 'blockquote'
    const paragraphs = parts.length >= 1 && parts.length <= 2 && parts.every((p) => p.type === 'paragraph')
    need(oneQuote || paragraphs, 'callout uses 1–2 consecutive paragraphs or one blockquote')
    return { tone: seg.callout_tone, markdown: spanOf(md, parts[0].node, parts.at(-1).node) }
  },

  steps_checklist(parts, seg, md) {
    need(parts.length === 1 && isOrderedList(parts[0]), 'steps_checklist uses exactly one ordered list')
    const items = parts[0].node.children
    need(items.length >= 2 && items.length <= 12, `steps_checklist needs 2–12 steps, the list has ${items.length}`)
    return { steps: items.map((it) => ({ markdown: itemContent(md, it) })) }
  },

  code_tabs(parts, seg, md) {
    need(parts.length >= 2 && parts.length <= 5 && parts.every((p) => p.type === 'code'), 'code_tabs uses 2–5 consecutive code blocks')
    const seen = new Map()
    const tabs = parts.map((p) => {
      const base = languageLabel(p.node.lang)
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { label: n > 1 ? `${base} (${n})` : base, language: p.node.lang || 'text', code: p.node.value }
    })
    need(tabs.every((t) => t.code.length > 0), 'code_tabs: a code block is empty')
    return { tabs }
  },

  comparison_table(parts, seg, md) {
    need(parts.length === 1 && parts[0].type === 'table', 'comparison_table uses exactly one table')
    return { markdown: span(md, parts[0].node) }
  },

  faq_accordion(parts, seg, md) {
    const items = []
    let i = 0
    while (i < parts.length) {
      const q = parts[i]
      need(q.type === 'heading' && q.depth === 3 && q.flags.is_question, `faq_accordion: ${q.id} must be an H3 question ending in "?"`)
      let j = i + 1
      while (j < parts.length && parts[j].type === 'paragraph') j++
      need(j > i + 1, `faq_accordion: the question ${q.id} has no answer paragraph`)
      items.push({ question_markdown: headingInner(md, q.node), answer_markdown: spanOf(md, parts[i + 1].node, parts[j - 1].node) })
      i = j
    }
    need(items.length >= 2 && items.length <= 12, `faq_accordion needs 2–12 questions, got ${items.length}`)
    return { items }
  },

  phone_ring_sim(parts, seg, md) {
    need(parts.length === 1 && isOrderedList(parts[0]), 'phone_ring_sim uses exactly one ordered list')
    const items = parts[0].node.children
    need(items.length >= 3 && items.length <= 8, `phone_ring_sim needs 3–8 moments, the list has ${items.length}`)
    const actors = seg.moment_actors ?? []
    need(actors.length === items.length, `phone_ring_sim needs one actor per moment (${items.length}), got ${actors.length}`)
    need(actors.every((a) => ACTORS.includes(a)), 'phone_ring_sim: unknown actor')
    items.forEach((it, k) => {
      const text = textOf(it).replace(/\s+/g, ' ').trim()
      const named = namedActor(text)
      need(!named || sameActor(named, actors[k]), `phone_ring_sim: moment ${k + 1} names ${named} ("${text.length > 60 ? `${text.slice(0, 60)}…` : text}") but its actor is ${actors[k]}`)
    })
    const states = actors.map((a) => PHONE_STATES[a])
    const ranks = states.map((st) => STATE_ORDER.indexOf(st))
    need(ranks.every((r, k) => k === 0 || r >= ranks[k - 1]) && STATE_ORDER.every((_, r) => ranks.includes(r)),
      `phone_ring_sim: the moments must go waiting → ringing → deciding → continuing (agent → M91 or phone → human → software), got ${states.join(' → ')}`)
    return { moments: items.map((it, k) => ({ actor: actors[k], markdown: itemContent(md, it) })) }
  },

  escalation_timeline(parts, seg, md) {
    need(parts.length === 1 && isOrderedList(parts[0]), 'escalation_timeline uses exactly one ordered list')
    const items = parts[0].node.children
    need(items.length >= 2 && items.length <= 10, `escalation_timeline needs 2–10 steps, the list has ${items.length}`)
    return { steps: items.map((it) => ({ markdown: itemContent(md, it) })) }
  },

  agent_terminal_replay(parts, seg, md) {
    need(parts.length === 1 && parts[0].type === 'code', 'agent_terminal_replay uses exactly one code block')
    const lang = parts[0].node.lang || 'text'
    need(TERMINAL_LANGUAGES.includes(lang), `agent_terminal_replay needs a text, bash, console or log code block, got "${lang}"`)
    const lines = String(parts[0].node.value).split('\n')
    need(lines.length >= 2 && lines.length <= 40, `agent_terminal_replay needs 2–40 lines, got ${lines.length}`)
    return { language: lang, lines }
  },

  choice_explorer(parts, seg, md) {
    need(parts.every((p) => p.type === 'paragraph'), 'choice_explorer uses paragraphs only')
    need(parts[0]?.flags.starts_with_bold, 'choice_explorer: the first paragraph must start with bold text (the choice)')
    const options = []
    for (const p of parts) {
      if (p.flags.starts_with_bold) {
        const strong = p.node.children[0]
        const rest = md.slice(strong.position.end.offset, p.node.position.end.offset)
        const lead = rest.length - rest.trimStart().length
        options.push({ choice_markdown: span(md, strong), outcomeStart: strong.position.end.offset + lead, outcomeEnd: p.node.position.end.offset })
      } else {
        options.at(-1).outcomeEnd = p.node.position.end.offset // a following paragraph belongs to the choice before it
      }
    }
    need(options.length >= 2 && options.length <= 4, `choice_explorer needs 2–4 choices, got ${options.length}`)
    const out = options.map((o) => ({ choice_markdown: o.choice_markdown, outcome_markdown: md.slice(o.outcomeStart, o.outcomeEnd) }))
    need(out.every((o) => o.outcome_markdown.trim().length > 0), 'choice_explorer: a choice has no outcome text')
    return { options: out }
  },

  troubleshooting_picker(parts, seg, md) {
    const items = []
    let i = 0
    while (i < parts.length) {
      const h = parts[i]
      need(h.type === 'heading' && h.depth === 3, `troubleshooting_picker: ${h.id} must be an H3 problem`)
      const cause = parts[i + 1]
      need(cause?.type === 'paragraph' && cause.flags.starts_with_likely_cause, `troubleshooting_picker: ${h.id} must be followed by a "Likely cause:" paragraph`)
      const causeText = span(md, cause.node)
      const fixLine = causeText.search(/\n\s*(\*\*|__)?fix\b/i)
      if (fixLine >= 0) {
        // "Likely cause:" and "Fix:" on consecutive lines are one paragraph: split it at the "Fix:" line.
        const fixAt = cause.node.position.start.offset + fixLine + causeText.slice(fixLine).search(/\S/)
        items.push({ problem_markdown: headingInner(md, h.node), cause_markdown: causeText.slice(0, fixLine), fix_markdown: md.slice(fixAt, cause.node.position.end.offset) })
        i += 2
      } else {
        const fix = parts[i + 2]
        need(fix?.type === 'paragraph' && fix.flags.starts_with_fix, `troubleshooting_picker: ${h.id} needs a "Fix:" paragraph after its likely cause`)
        items.push({ problem_markdown: headingInner(md, h.node), cause_markdown: causeText, fix_markdown: span(md, fix.node) })
        i += 3
      }
    }
    need(items.length >= 2 && items.length <= 10, `troubleshooting_picker needs 2–10 problems, got ${items.length}`)
    return { items }
  }
}

/**
 * One block's data from parts, by its builder's pattern (Phase 10: the Experience Designer reuses these for the
 * guide components that hold the Writer's text). Returns { ok: true, data } or { ok: false, reason }.
 */
export function buildFromParts(type, parts, seg, md) {
  if (!BUILDERS[type]) return { ok: false, reason: `no builder for "${type}"` }
  try {
    return { ok: true, data: BUILDERS[type](parts, seg, md) }
  } catch (error) {
    if (error instanceof PatternError) return { ok: false, reason: error.message }
    throw error
  }
}

/**
 * Builds the post's blocks from a plan.
 * @param {{ segments: object[] }} plan  the Designer's plan (section 7.3)
 * @param {{ markdown: string, parts: object[] }} parsed  from parseParts()
 * @param {{ maxBlocks?: number }} options  DESIGNER_MAX_INTERACTIVE_BLOCKS
 * @returns {{ blocks, layout: { block_id, part_ids }[], kept: object[], dropped: { index, block_type, part_ids, reason }[] }}
 */
export function buildBlocks(plan, { markdown: md, parts }, { maxBlocks = 6 } = {}) {
  const index = new Map(parts.map((p, i) => [p.id, i]))
  const dropped = []
  const kept = [] // { from, to, type, data, segment, index }
  let lastEnd = -1
  ;(plan?.segments ?? []).forEach((seg, n) => {
    const drop = (reason) => dropped.push({ index: n, block_type: seg?.block_type ?? null, part_ids: seg?.part_ids ?? [], reason })
    if (!DESIGNER_BLOCK_TYPES.includes(seg?.block_type)) return drop(`"${seg?.block_type}" is not a block type the Designer may choose`)
    const ids = Array.isArray(seg.part_ids) ? seg.part_ids : []
    if (!ids.length) return drop('no part ids')
    const pos = ids.map((id) => index.get(id))
    if (pos.some((p) => p === undefined)) return drop(`unknown part id(s): ${ids.filter((id) => !index.has(id)).join(', ')}`)
    if (pos.some((p, k) => k > 0 && p !== pos[k - 1] + 1)) return drop('the part ids are not a contiguous range in order')
    if (pos[0] <= lastEnd) return drop('overlaps or comes before an earlier segment')
    if (kept.length >= maxBlocks) return drop(`over the limit of ${maxBlocks} interactive blocks`)
    let data
    try {
      data = BUILDERS[seg.block_type](pos.map((p) => parts[p]), seg, md)
    } catch (error) {
      if (error instanceof PatternError) return drop(error.message)
      throw error
    }
    const errors = validateBlock({ type: seg.block_type, id: 'b1', data })
    if (errors.length) return drop(`block data is not valid: ${errors.slice(0, 2).join('; ')}`)
    kept.push({ from: pos[0], to: pos.at(-1), type: seg.block_type, data, segment: seg, index: n })
    lastEnd = pos.at(-1)
  })

  // Walk the parts in order: a kept segment becomes its block; the parts between become rich_text blocks.
  const blocks = []
  const layout = []
  const add = (type, data, from, to) => {
    const id = `b${blocks.length + 1}`
    blocks.push({ type, id, data })
    layout.push({ block_id: id, part_ids: parts.slice(from, to + 1).map((p) => p.id) })
  }
  let k = 0
  let i = 0
  while (i < parts.length) {
    if (k < kept.length && kept[k].from === i) {
      add(kept[k].type, kept[k].data, kept[k].from, kept[k].to)
      i = kept[k].to + 1
      k++
      continue
    }
    const stop = k < kept.length ? kept[k].from - 1 : parts.length - 1
    add('rich_text', { markdown: md.slice(parts[i].start, parts[stop].end) }, i, stop)
    i = stop + 1
  }
  return { blocks, layout, kept: kept.map((s) => ({ index: s.index, block_type: s.type, part_ids: s.segment.part_ids, why: s.segment.why ?? '' })), dropped }
}
