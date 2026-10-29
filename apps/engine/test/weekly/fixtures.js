// Shared fixtures for the weekly editor tests: a pick (with or without a news hook) and M91 facts.

export const HOOK = { record_id: 'mem-n1', opportunity_id: 'O-261022-0900-NEWS', title: 'An AI agent deleted a production database', what_happened: 'A coding agent ran a destructive command without asking.', outlet: 'The Register', published_date: '2026-10-21', source_url: 'https://www.theregister.com/2026/10/21/agent_db/', why_m91: 'A phone call would have stopped it.' }
export const weeklyTarget = (over = {}) => ({
  kind: 'weekly',
  pick: { pick_id: 'W-261022-1200-PICK', title: 'How to make an AI agent ask before it deletes data', question: 'How do I make my AI agent ask a person before it deletes data?', format: 'tutorial', angle: 'a step-by-step pause before destructive tool calls', why_now: 'an agent deleted a production database this week', hook: null, evidence: [{ id: 'q1', kind: 'question', text: 'How to stop Claude Code running rm -rf?', url: 'https://www.reddit.com/r/ClaudeAI/comments/abc/', where: 'Reddit r/ClaudeAI', demand: '320 upvotes' }], ...over }
})

export const FACTS = { can: [{ fact: 'Rings every phone in a channel until someone answers.', source_url: 'https://m91-api.msg91.com/llms.txt' }], cannot: [], integrations: [{ name: 'Claude Code', what_it_enables: 'a phone call before a risky command', source_url: 'https://m91-api.msg91.com/llms.txt' }] }
