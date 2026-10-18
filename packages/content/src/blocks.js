// Block type names for post format v1. Their data schemas come in Phase 8.
// A block object is { type: <one of these>, id: string, data: object }.

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

export const isBlockType = (name) => BLOCK_TYPES.includes(name)
