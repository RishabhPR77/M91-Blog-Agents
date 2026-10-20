// Block type names for post format v1. A block object is { type: <one of these>, id: "b1", data: object }.
// BUILT_BLOCK_TYPES have a data schema (src/blocks/<type>.schema.json) and a blog component (Phase 8);
// the others are reserved: the Designer never chooses them, and the blog shows them as plain text.

export const BLOCK_TYPES = Object.freeze([
  'rich_text',
  'takeaways',
  'callout',
  'steps_checklist',
  'code_tabs',
  'comparison_table',
  'faq_accordion',
  'phone_ring_sim',
  'escalation_timeline',
  'alert_triage_quiz',
  'agent_terminal_replay',
  'choice_explorer',
  'troubleshooting_picker',
  'try_it',
  'diagram',
  'cta_panel'
])

export const BUILT_BLOCK_TYPES = Object.freeze([
  'rich_text',
  'callout',
  'steps_checklist',
  'code_tabs',
  'comparison_table',
  'faq_accordion',
  'phone_ring_sim',
  'escalation_timeline',
  'agent_terminal_replay',
  'choice_explorer',
  'troubleshooting_picker'
])

/** Block ids: b1, b2, … (unique in a post). */
export const BLOCK_ID_RE = /^b[1-9][0-9]*$/

export const isBlockType = (name) => BLOCK_TYPES.includes(name)
export const isBuiltBlockType = (name) => BUILT_BLOCK_TYPES.includes(name)
