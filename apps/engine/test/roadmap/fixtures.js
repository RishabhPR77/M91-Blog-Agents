// Phase 12 test fixtures: a valid Roadmap Planner answer and a roadmap built from it.
import { roadmapFromAnswer } from '../../src/planner/index.js'

const slot = (slot_id, title_idea, question, teaches, needs = []) => ({ slot_id, title_idea, question, teaches, needs })

/** A valid Planner answer: 2 Starter slots, 3 slots in each other stage. */
export function goodAnswer() {
  return {
    covered: [],
    stages: [
      { number: 0, slots: [
        slot('s0-1', 'What M91 is and why software needs a human', 'What is M91 and why would my software need a person?', ['human decision', 'M91']),
        slot('s0-2', 'How M91 works in 5 minutes', 'How does M91 work?', ['alert', 'channel', 'callback'], ['s0-1'])
      ] },
      { number: 1, slots: [
        slot('s1-1', 'What a human approval step is', 'What is a human approval step?', ['approval step'], ['s0-2']),
        slot('s1-2', 'Why a phone call beats a chat message', 'Why should a phone ring for a decision?', ['urgent alert'], ['s1-1']),
        slot('s1-3', 'One owner for every decision', 'Who should decide when software asks?', ['one owner'], ['s1-1'])
      ] },
      { number: 2, slots: [
        slot('s2-1', 'Create a channel and send your first alert', 'How do I send my first M91 alert?', ['send link'], ['s0-2']),
        slot('s2-2', 'Read the answer back in your code', 'How does my code get the answer?', ['callback URL'], ['s2-1']),
        slot('s2-3', 'Test it with your own phone', 'How do I test an alert safely?', ['test alert'], ['s2-1'])
      ] },
      { number: 3, slots: [
        slot('s3-1', 'Let an AI agent ask before it deletes data', 'How can my AI agent ask before a risky step?', ['agent approval'], ['s2-2']),
        slot('s3-2', 'Approve large refunds by phone', 'How do I make refunds wait for a person?', ['refund approval'], ['s2-2']),
        slot('s3-3', 'Wake the on-call person for a real outage', 'How do I wake someone only for real outages?', ['on-call alert'], ['s2-1'])
      ] },
      { number: 4, slots: [
        slot('s4-1', 'What is worth waking someone for', 'Which alerts should ring a phone?', ['alert rules'], ['s3-3']),
        slot('s4-2', 'Timeouts and safe defaults', 'What happens if nobody answers?', ['timeout', 'safe default'], ['s3-1']),
        slot('s4-3', 'Write alerts a person can answer fast', 'How do I write a clear alert?', ['alert text'], ['s1-3'])
      ] },
      { number: 5, slots: [
        slot('s5-1', 'M91 vs a Slack message for approvals', 'Is M91 better than a Slack message for approvals?', ['channel choice'], ['s1-2']),
        slot('s5-2', 'Moving off Opsgenie', 'How do I migrate my alerts from Opsgenie?', ['migration plan'], ['s3-3']),
        slot('s5-3', 'M91 compared with a pager tool', 'How does M91 compare with a pager?', ['pager'], ['s5-1'])
      ] }
    ],
    notes: 'none'
  }
}

export const goodRoadmap = () => roadmapFromAnswer(goodAnswer())
export const FACTS = { can: [{ fact: 'Rings every phone in a channel until someone answers.', source_url: 'https://m91-api.msg91.com/llms.txt' }], cannot: [], integrations: [] }
